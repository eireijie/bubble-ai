package ai.wisp.android

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Saving a file the web app downloads into the phone's Downloads folder. A web view can't save the
 * page's blob: links itself, so the page reads the bytes and hands them over in base64 chunks
 * (see [MainActivity] → saveBegin / saveChunk / saveEnd).
 */
class Downloads(private val context: Context) {
    private class Save(val name: String, val out: OutputStream, val uri: Uri?)
    private val open = ConcurrentHashMap<String, Save>()

    /** Starts a file in Downloads; returns its id for the chunks, or null when it can't be written. */
    fun begin(name: String, mime: String): String? {
        val clean = safeName(name)
        val type = mime.ifBlank { "application/octet-stream" }
        val save = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, clean)
                    put(MediaStore.Downloads.MIME_TYPE, type)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
                val out = context.contentResolver.openOutputStream(uri) ?: return null
                Save(clean, out, uri)
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).takeIf { it.canWrite() || it.mkdirs() }
                    ?: context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return null
                Save(clean, FileOutputStream(unique(dir, clean)), null)
            }
        } catch (e: Exception) {
            return null
        }
        val id = UUID.randomUUID().toString()
        open[id] = save
        return id
    }

    fun chunk(id: String, base64: String): Boolean {
        val s = open[id] ?: return false
        return try {
            s.out.write(Base64.decode(base64, Base64.DEFAULT))
            true
        } catch (e: Exception) {
            fail(id)
            false
        }
    }

    /** Finishes the file; returns the name it was saved under, or null. */
    fun end(id: String): String? {
        val s = open.remove(id) ?: return null
        return try {
            s.out.close()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && s.uri != null) {
                context.contentResolver.update(s.uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            }
            s.name
        } catch (e: Exception) {
            s.uri?.let { runCatching { context.contentResolver.delete(it, null, null) } }
            null
        }
    }

    /** Drops a half-written file. */
    fun fail(id: String) {
        val s = open.remove(id) ?: return
        runCatching { s.out.close() }
        s.uri?.let { runCatching { context.contentResolver.delete(it, null, null) } }
    }

    private fun unique(dir: File, name: String): File {
        var f = File(dir, name)
        val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
        var n = 1
        while (f.exists()) f = File(dir, "${name.substring(0, dot)} ($n)${name.substring(dot)}").also { n++ }
        return f
    }

    companion object {
        /** A file name with nothing that could leave the Downloads folder or upset the file system. */
        fun safeName(name: String): String =
            name.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[\\u0000-\\u001f:*?\"<>|]"), "_").trim().trimStart('.').take(120).ifBlank { "download" }
    }
}
