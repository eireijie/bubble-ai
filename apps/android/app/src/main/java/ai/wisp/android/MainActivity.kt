package ai.wisp.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.animation.ValueAnimator
import android.app.AlertDialog
import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.SpannableString
import android.text.Spanned
import android.text.TextWatcher
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.view.animation.PathInterpolator
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject

/**
 * Bubble AI for Android: pair with Bubble AI on your computer by scanning the QR code in Settings → Computers → Phone,
 * then use Bubble AI's own phone layout in a web view, signed in with the session the pairing gave you.
 *
 * The hub is usually reached over plain http on the home network, which isn't a secure context, so the
 * page has no async clipboard and can't save blob: downloads. The `WispAndroid` bridge does those natively.
 */
class MainActivity : Activity() {
    private val prefs by lazy {
        val current = getSharedPreferences("wisp", MODE_PRIVATE)
        val legacy = getSharedPreferences("warren", MODE_PRIVATE)
        val editor = current.edit()
        for ((oldKey, value) in legacy.all) {
            val key = if (oldKey.startsWith("warren")) "wisp" + oldKey.removePrefix("warren") else oldKey
            if (current.contains(key)) continue
            when (value) {
                is String -> editor.putString(key, value)
                is Boolean -> editor.putBoolean(key, value)
                is Int -> editor.putInt(key, value)
                is Long -> editor.putLong(key, value)
                is Float -> editor.putFloat(key, value)
                is Set<*> -> editor.putStringSet(key, value.filterIsInstance<String>().toSet())
            }
        }
        // Only retire the old values after the replacement is persisted.
        if (editor.commit()) legacy.edit().clear().commit()
        current
    }
    private val downloads by lazy { Downloads(applicationContext) }
    private var web: WebView? = null
    /** bumped to abandon a pairing in progress */
    @Volatile private var pairing = 0
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var fileMultiple = false
    private var micRequest: PermissionRequest? = null
    /** a tapped notification's hash route (#/c/…) waiting for the web view to load */
    private var pendingRoute: String? = null
    /** whether this run already asked the hub about push (once per signed-in web view) */
    private var pushChecked = false
    /** the pairing screen's current step, so a light/dark switch can redraw it */
    private var shown: Triple<Step, String?, String?> = Triple(Step.Start, null, null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val link = PairLink.parse(intent?.dataString)
        pendingRoute = intent?.getStringExtra(ROUTE)?.ifEmpty { null }
        if (hub != null && token != null) showWorkspace() else showPairing()
        link?.let(::offer)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        PairLink.parse(intent.dataString)?.let(::offer)
        intent.getStringExtra(ROUTE)?.ifEmpty { null }?.let(::open)
    }

    override fun onResume() {
        super.onResume()
        Push.foreground = true
    }

    override fun onPause() {
        Push.foreground = false
        super.onPause()
    }

    /** Light/dark changed while the app is open (the activity isn't recreated for it). */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val v = web
        if (v == null) {
            val (s, code, error) = shown
            screen = Screen.None
            step(s, code, error)
            return
        }
        // the page follows the system unless the person picked a mode; it reports back through theme()
        val bg = getColor(R.color.bg)
        findViewById<View>(R.id.loader)?.setBackgroundColor(bg)
        findViewById<View>(R.id.offline)?.setBackgroundColor(bg)
        v.postDelayed({ if (web === v) v.evaluateJavascript("window.__bubbleTheme&&window.__bubbleTheme(true)", null) }, 300)
    }

    /** A tapped notification: go to its chat, approval or computer in the web app. */
    private fun open(route: String) {
        val v = web
        if (v == null) { pendingRoute = route; return }
        v.evaluateJavascript("location.hash=${JSONObject.quote(route)}", null)
    }

    private var hub: String?
        get() = prefs.getString("hub", null)
        set(v) = prefs.edit().putString("hub", v).apply()
    private var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v).apply()

    /** A pairing link from the camera app: pair now, or ask first if this phone is already signed in. */
    private fun offer(link: PairLink) {
        if (web == null) return pair(link)
        AlertDialog.Builder(this)
            .setTitle("Pair with another computer?")
            .setMessage("This phone will sign out of the one it's paired with now.")
            .setPositiveButton("Pair") { _, _ -> signOut(); pair(link) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ---------------------------------------------------------------- pairing

    /** Signed out: the welcome screen, which scanning or typing a link moves on from. */
    private fun showPairing() {
        web?.destroy()
        web = null
        screen = Screen.None
        step(Step.Start)
    }

    private enum class Step { Start, Connecting, Code }
    private enum class Screen { None, Welcome, Steps }

    /** which pairing layout is up, so a step only inflates when it changes */
    private var screen = Screen.None

    /**
     * The welcome screen (canvas "Phone welcome", round 2): the bubbles, "Bubble" and one line, then
     * "Scan a QR code" and "or type a link". A phone without a camera gets "Type a link" as the big button.
     * A pairing that didn't work comes back here with why under the line.
     */
    private fun showWelcome(error: String?) {
        setContentView(R.layout.welcome)
        screen = Screen.Welcome
        val density = resources.displayMetrics.density
        val root = findViewById<View>(R.id.welcome)
        val words = findViewById<View>(R.id.words)
        val actions = findViewById<View>(R.id.actions)
        val opening = !welcomed
        welcomed = true
        findViewById<BubbleFieldView>(R.id.field).opening = opening
        systemBars(getColor(R.color.welcome_ground), resources.getBoolean(R.bool.light_bars))
        // the bubbles go under the bars; only the buttons keep clear of them
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val pad = actions.paddingBottom
            root.setOnApplyWindowInsetsListener { _, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                actions.setPadding(actions.paddingLeft + bars.left, actions.paddingTop, actions.paddingRight + bars.right, pad + bars.bottom)
                insets
            }
        }
        // the words sit under the big bubble, which floats 42% of the way down
        root.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ -> words.translationY = v.height * 0.42f + 118 * density }

        val camera = packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        val scan = findViewById<View>(R.id.scan)
        val type = findViewById<Button>(R.id.typeLink)
        type.text = getText(R.string.welcome_or_type)
        type.setOnClickListener { askForLink() }
        if (camera) {
            scan.setOnClickListener { scan() }
        } else {
            findViewById<ImageView>(R.id.scanIcon).setImageResource(R.drawable.ic_link)
            findViewById<TextView>(R.id.scanText).setText(R.string.welcome_type)
            scan.setOnClickListener { askForLink() }
            type.visibility = View.GONE
        }
        findViewById<TextView>(R.id.error).apply {
            text = error ?: ""
            visibility = if (error == null) View.GONE else View.VISIBLE
        }

        // first time in a run: "Bubble" at 550 ms, the line at 700 ms, the buttons at 850 ms
        if (opening) {
            val moving = ValueAnimator.areAnimatorsEnabled()
            val ease = PathInterpolator(0.2f, 0.8f, 0.2f, 1f)
            for ((id, delay) in listOf(R.id.name to 550L, R.id.tagline to 700L, R.id.actions to 850L)) {
                val v = findViewById<View>(id)
                v.alpha = 0f
                if (moving) v.translationY = 14 * density
                v.animate().alpha(1f).translationY(0f).setStartDelay(delay).setDuration(if (moving) 700 else 300).setInterpolator(ease).start()
            }
        }
    }

    private fun step(s: Step, code: String? = null, error: String? = null) {
        if (web != null) return
        shown = Triple(s, code, error)
        if (s == Step.Start) return showWelcome(error)
        if (screen != Screen.Steps) {
            setContentView(R.layout.pair)
            screen = Screen.Steps
            fitSystemBars(findViewById(R.id.root))
            systemBars(getColor(R.color.bg), resources.getBoolean(R.bool.light_bars))
            findViewById<Button>(R.id.cancel).setOnClickListener { pairing++; step(Step.Start) }
        }
        fun show(id: Int, on: Boolean) { findViewById<View>(id).visibility = if (on) View.VISIBLE else View.GONE }
        show(R.id.connecting, s == Step.Connecting)
        show(R.id.codeBox, s == Step.Code)
        findViewById<TextView>(R.id.title).text = if (s == Step.Code) "Check the code" else "Pair with your computer"
        findViewById<TextView>(R.id.lede).text =
            if (s == Step.Code) "Confirm on your computer if it shows the same code." else "In Bubble AI on your computer, open Settings → Computers → Phone."
        findViewById<TextView>(R.id.code).text = code ?: ""
        findViewById<TextView>(R.id.error).apply {
            text = error ?: ""
            visibility = if (error == null) View.GONE else View.VISIBLE
        }
    }

    private fun scan() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options)
            .startScan()
            .addOnSuccessListener { use(it.rawValue) }
            .addOnFailureListener { step(Step.Start, error = "Couldn't open the scanner. Type the link instead.") }
    }

    /**
     * "Type a link": a bottom sheet with one field, checked as it's typed. A pairing link already on the
     * clipboard is offered as a one-tap suggestion; Connect stays dimmed until the field holds a link that works.
     */
    private fun askForLink() {
        val sheet = layoutInflater.inflate(R.layout.type_link, null)
        val dialog = Dialog(this, android.R.style.Theme_Material_Dialog_NoActionBar)
        dialog.setContentView(sheet)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT)
            setGravity(Gravity.BOTTOM)
            setDimAmount(0.38f)
            setWindowAnimations(android.R.style.Animation_InputMethod)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        }
        val input = sheet.findViewById<EditText>(R.id.linkField)
        val copied = sheet.findViewById<View>(R.id.copied)
        val status = sheet.findViewById<View>(R.id.status)
        val ok = sheet.findViewById<View>(R.id.statusOk)
        val line = sheet.findViewById<TextView>(R.id.statusText)
        val connect = sheet.findViewById<Button>(R.id.connect)
        var link: PairLink? = null

        val clip = runCatching {
            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()
        }.getOrNull()
        val suggestion = clip?.let(PairLink::find)?.takeIf { PairLink.parse(it) != null }

        fun refresh() {
            val check = PairLink.check(input.text.toString())
            link = (check as? PairLink.Check.Ok)?.link
            input.isActivated = link != null
            connect.isEnabled = link != null
            connect.alpha = if (link != null) 1f else 0.38f
            copied.visibility = if (suggestion != null && input.text.toString().trim() != suggestion) View.VISIBLE else View.GONE
            status.visibility = View.VISIBLE
            ok.visibility = View.GONE
            line.setTextColor(getColor(R.color.sheet_muted))
            when (check) {
                is PairLink.Check.Ok -> {
                    val place = check.link.firstPlace
                    val more = check.link.addresses.size - 1
                    val text = if (more > 0) getString(R.string.link_will_try_more, place, more) else getString(R.string.link_will_try, place)
                    val start = text.indexOf(place)
                    line.text = SpannableString(text).apply {
                        if (start >= 0) {
                            setSpan(StyleSpan(Typeface.BOLD), start, start + place.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            setSpan(ForegroundColorSpan(getColor(R.color.sheet_ink)), start, start + place.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        }
                    }
                    line.isSingleLine = true
                    ok.visibility = View.VISIBLE
                }
                PairLink.Check.Incomplete -> { line.isSingleLine = false; line.setText(R.string.link_incomplete) }
                PairLink.Check.Address -> { line.isSingleLine = false; line.setText(R.string.link_address); line.setTextColor(getColor(R.color.bad)) }
                PairLink.Check.Wrong -> { line.isSingleLine = false; line.setText(R.string.link_wrong); line.setTextColor(getColor(R.color.bad)) }
                PairLink.Check.Empty, PairLink.Check.Typing -> status.visibility = View.GONE
            }
        }
        fun go() {
            val l = link ?: return
            dialog.dismiss()
            pair(l)
        }

        sheet.findViewById<TextView>(R.id.copiedLink).text = suggestion
        sheet.findViewById<Button>(R.id.useCopied).setOnClickListener {
            input.setText(suggestion)
            input.setSelection(input.text.length)
        }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) = refresh()
        })
        input.setOnEditorActionListener { _, action, _ -> if (action == EditorInfo.IME_ACTION_GO) { go(); true } else false }
        connect.setOnClickListener { go() }
        refresh()
        dialog.setOnShowListener { input.requestFocus() }
        dialog.show()
    }

    private fun use(text: String?) {
        val link = PairLink.parse(text) ?: return step(Step.Start, error = "That isn't a Bubble AI pairing code. Scan the one in Settings → Computers → Phone.")
        pair(link)
    }

    private fun pair(link: PairLink) {
        if (web != null) showPairing()
        val mine = ++pairing
        step(Step.Connecting)
        Thread {
            try {
                val at = Pairing.reachable(link.addresses)
                    ?: throw PairingError("Couldn't reach your computer. Make sure this phone is on the same Wi-Fi, then try again.")
                val claimed = Pairing.claim(link, at, deviceName())
                runOnUiThread {
                    if (pairing == mine) step(Step.Code, claimed.code)
                }
                val t = Pairing.waitForConfirm(link, at) { pairing == mine } ?: return@Thread
                runOnUiThread {
                    if (pairing != mine) return@runOnUiThread
                    hub = at
                    token = t
                    showWorkspace()
                }
            } catch (e: Exception) {
                runOnUiThread { if (pairing == mine) step(Step.Start, error = e.message ?: "Pairing didn't work. Try again.") }
            }
        }.start()
    }

    private fun deviceName(): String =
        Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: Build.MODEL

    // ---------------------------------------------------------------- the workspace

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWorkspace() {
        val origin = hub ?: return showPairing()
        val signIn = token ?: return showPairing()
        // debug builds can be inspected from chrome://inspect
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        val view = WebView(this)
        web = view
        // a web view ignores its own padding, so the space for the system bars goes on a frame around it
        setContentView(R.layout.workspace)
        val frame = findViewById<FrameLayout>(R.id.frame)
        frame.addView(view, 0, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val loader = findViewById<View>(R.id.loader)
        val offline = findViewById<View>(R.id.offline)
        fitSystemBars(frame)
        systemBars(getColor(R.color.bg), resources.getBoolean(R.bool.light_bars))
        // no white flash before the page paints
        view.setBackgroundColor(getColor(R.color.bg))
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }
        // Bubble AI keeps its sign-in in localStorage; put the paired one there before the page runs
        // and hear about it when Bubble AI drops it (signed out here, or this phone's sign-in was ended on the computer).
        // wisp.androidPair remembers which pairing the storage belongs to: after a new pairing, whatever the
        // last one left (its revoked sign-in above all) is cleared before the page can use it.
        val quoted = JSONObject.quote(signIn)
        val setToken = "Object.keys(localStorage).filter(k=>k.startsWith('warren.')).forEach(k=>{" +
            "var n='wisp.'+k.slice(7);if(localStorage.getItem(n)===null)localStorage.setItem(n,localStorage.getItem(k));localStorage.removeItem(k);});" +
            "(function(T){var P=localStorage.getItem('wisp.androidPair');" +
            "if(P!==T&&!(P===null&&localStorage.getItem('wisp.token')===T)){var keep=['wisp.mode','wisp.theme','wisp.textSize','wisp.motion'];" +
            "Object.keys(localStorage).forEach(function(k){if(keep.indexOf(k)<0)localStorage.removeItem(k);});try{sessionStorage.clear();}catch(e){}}" +
            "localStorage.setItem('wisp.androidPair',T);" +
            "if(!localStorage.getItem('wisp.token'))localStorage.setItem('wisp.token',T);})($quoted);" +
            "(function(){var r=Storage.prototype.removeItem;Storage.prototype.removeItem=function(k){r.apply(this,arguments);" +
            "if(k==='wisp.token'&&this===window.localStorage&&window.WispAndroid)WispAndroid.signedOut();};})();"
        view.addJavascriptInterface(Bridge(view, origin), "WispAndroid")
        val early = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (early) WebViewCompat.addDocumentStartJavaScript(view, setToken + SHELL_SCRIPT, setOf(origin))
        var tokenSet = early
        var failed = false
        view.setDownloadListener { url, _, contentDisposition, mimeType, _ -> download(view, origin, url, contentDisposition, mimeType) }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.toString().startsWith("$origin/") || url.toString() == origin) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                return true
            }

            override fun onPageStarted(v: WebView, url: String, favicon: Bitmap?) {
                failed = false
            }

            // the saved address stopped answering (the computer is off, or its address changed): a screen of our own
            // with Retry, instead of the browser's error page
            override fun onReceivedError(v: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame || web !== v) return
                failed = true
                loader.visibility = View.GONE
                offline.visibility = View.VISIBLE
            }

            override fun onPageCommitVisible(v: WebView, url: String) {
                if (!failed) loader.visibility = View.GONE
            }

            override fun onPageFinished(v: WebView, url: String) {
                if (failed) return
                loader.visibility = View.GONE
                offline.visibility = View.GONE
                if (tokenSet && !pushChecked) setUpPush()
                if (tokenSet) return
                tokenSet = true
                v.evaluateJavascript(setToken + SHELL_SCRIPT) { v.reload() }
            }
        }
        findViewById<Button>(R.id.retry).setOnClickListener {
            offline.visibility = View.GONE
            loader.visibility = View.VISIBLE
            view.loadUrl("$origin/")
        }
        findViewById<Button>(R.id.repair).setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Pair again?")
                .setMessage("This phone will sign out. You can pair it again from your computer.")
                .setPositiveButton("Sign out") { _, _ -> signOut() }
                .setNegativeButton("Cancel", null)
                .show()
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                fileMultiple = params.mode == FileChooserParams.MODE_OPEN_MULTIPLE
                return try {
                    startActivityForResult(params.createIntent(), PICK_FILES)
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE !in request.resources) return request.deny()
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) return request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                micRequest = request
                requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), ASK_MIC)
            }
        }
        pushChecked = false
        view.loadUrl("$origin/" + (pendingRoute ?: ""))
        pendingRoute = null
    }

    /** What the page can ask of the app. Calls arrive on a background thread. */
    private inner class Bridge(private val view: WebView, private val origin: String) {
        @JavascriptInterface
        fun signedOut() = runOnUiThread { if (web === view) signOut() }

        /** Settings → Notifications asks: this app handles push itself (a web view can't do Web Push). */
        @JavascriptInterface
        fun pushState(): String = Push.state(this@MainActivity).toString()

        /** "Turn on": the system permission prompt (Android 13+), then register with the hub. */
        @JavascriptInterface
        fun enablePush() = runOnUiThread { if (web === view) askForNotifications() }

        /** Copy: the page's own clipboard API needs https. */
        @JavascriptInterface
        fun copyText(text: String) = runOnUiThread {
            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Bubble AI", text))
        }

        @JavascriptInterface
        fun readText(): String =
            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this@MainActivity)?.toString() ?: ""

        /** The page's light/dark and its surface color, for the status and navigation bars. */
        @JavascriptInterface
        fun theme(mode: String, color: String) = runOnUiThread {
            if (web !== view) return@runOnUiThread
            val dark = mode == "dark"
            val bg = runCatching { Color.parseColor(color.trim()) }.getOrNull() ?: if (dark) DARK_BG else Color.WHITE
            findViewById<View>(R.id.frame)?.setBackgroundColor(bg)
            findViewById<View>(R.id.loader)?.setBackgroundColor(bg)
            findViewById<View>(R.id.offline)?.setBackgroundColor(bg)
            view.setBackgroundColor(bg)
            systemBars(bg, !dark)
        }

        @JavascriptInterface
        fun saveBegin(name: String, mime: String): String = downloads.begin(name, mime) ?: "".also { saved(null) }

        @JavascriptInterface
        fun saveChunk(id: String, base64: String): Boolean = downloads.chunk(id, base64)

        @JavascriptInterface
        fun saveEnd(id: String) = saved(downloads.end(id))

        @JavascriptInterface
        fun saveFailed(id: String) {
            downloads.fail(id)
            saved(null)
        }
    }

    private fun saved(name: String?) = runOnUiThread {
        Toast.makeText(this, if (name != null) "Saved to Downloads" else "Couldn't save the file", Toast.LENGTH_SHORT).show()
    }

    /**
     * A download the page started. Blob and data links (how the web app saves files) and the hub's own files are
     * read by the page, which hands the bytes over; any other link goes to the browser.
     */
    private fun download(view: WebView, origin: String, url: String, contentDisposition: String?, mimeType: String?) {
        val mine = url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("$origin/")
        if (!mine) {
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            return
        }
        val named = contentDisposition?.takeIf { it.contains("filename", ignoreCase = true) }?.let { URLUtil.guessFileName(url, it, mimeType) }
        val js = "(async function(u,n,m){var id='';try{var r=await fetch(u,u.indexOf('blob:')===0||u.indexOf('data:')===0?{}:{headers:{authorization:'Bearer '+(localStorage.getItem('wisp.token')||'')}});" +
            "if(!r.ok)throw new Error(r.status);var b=await r.blob();" +
            "var name=n||(window.__bubbleDownloads||{})[u]||'download';id=WispAndroid.saveBegin(name,m||b.type||'application/octet-stream');if(!id)return;" +
            "for(var i=0;i<b.size;i+=786432){var a=new Uint8Array(await b.slice(i,i+786432).arrayBuffer()),s='';" +
            "for(var j=0;j<a.length;j+=32768)s+=String.fromCharCode.apply(null,a.subarray(j,j+32768));if(!WispAndroid.saveChunk(id,btoa(s)))return;}" +
            "WispAndroid.saveEnd(id);}catch(e){WispAndroid.saveFailed(id);}})(${JSONObject.quote(url)},${JSONObject.quote(named ?: "")},${JSONObject.quote(mimeType ?: "")})"
        view.evaluateJavascript(js, null)
    }

    // ---------------------------------------------------------------- push notifications

    /** Once the workspace has loaded: if the hub can push to Android, ask for permission (once) and register this phone. */
    private fun setUpPush() {
        pushChecked = true
        val h = hub ?: return
        val t = token ?: return
        Thread {
            if (!Push.sync(this, h, t)) return@Thread
            runOnUiThread {
                if (!Push.hasPermission(this) && !prefs.getBoolean("askedPush", false)) {
                    prefs.edit().putBoolean("askedPush", true).apply()
                    askForNotifications()
                }
            }
        }.start()
    }

    private fun askForNotifications() {
        if (Push.hasPermission(this)) {
            val h = hub ?: return
            val t = token ?: return
            Thread { if (Push.sync(this, h, t)) Push.register(this, h, t) }.start()
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), ASK_NOTIFICATIONS)
        }
    }

    private fun signOut() {
        pairing++
        Push.forget(this, hub, token)
        prefs.edit().clear().apply()
        // Clear the page's storage from inside it, synchronously, while it is still open. (WebStorage.deleteAllData()
        // finishes whenever it likes, which could be after the next pairing's page has stored its sign-in.) The next
        // page also checks wisp.androidPair, so anything left over from this pairing is dropped there.
        web?.evaluateJavascript("try{var keep=['wisp.mode','wisp.theme','wisp.textSize','wisp.motion'];Object.keys(localStorage).forEach(function(k){if(keep.indexOf(k)<0)localStorage.removeItem(k);});sessionStorage.clear();}catch(e){}", null)
        CookieManager.getInstance().removeAllCookies(null)
        showPairing()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PICK_FILES) {
            fileCallback?.onReceiveValue(picked(resultCode, data))
            fileCallback = null
        } else super.onActivityResult(requestCode, resultCode, data)
    }

    /** What the chooser returned. The photo picker (and Photos) answer with ClipData, which parseResult ignores. */
    private fun picked(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != RESULT_OK || data == null) return null
        val clip = data.clipData
        val uris = if (clip != null && clip.itemCount > 0) List(clip.itemCount) { clip.getItemAt(it).uri }.filterNotNull() else listOfNotNull(data.data)
        if (uris.isEmpty()) return WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        return (if (fileMultiple) uris else uris.take(1)).toTypedArray()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        if (requestCode == ASK_NOTIFICATIONS) {
            if (results.firstOrNull() == PackageManager.PERMISSION_GRANTED) askForNotifications()
            web?.evaluateJavascript("window.dispatchEvent(new CustomEvent('wisp-push-state'))", null)
            return
        }
        if (requestCode != ASK_MIC) return
        val r = micRequest ?: return
        micRequest = null
        if (results.firstOrNull() == PackageManager.PERMISSION_GRANTED) r.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else r.deny()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val v = web
        if (v != null && v.canGoBack() && findViewById<View>(R.id.offline)?.visibility != View.VISIBLE) v.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    /**
     * Android 15 draws apps under the status and navigation bars and ignores adjustResize; keep Bubble AI
     * clear of them and the keyboard: the frame is padded by the keyboard's height, so the web view
     * shrinks above it (older Androids resize the window themselves, adjustResize in the manifest).
     * When the keyboard opens, the field being typed in is scrolled up into view, clear of a sheet's
     * buttons that stick to the bottom.
     */
    private fun fitSystemBars(view: View) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        var keyboard = false
        view.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            val open = insets.isVisible(WindowInsets.Type.ime())
            if (open && !keyboard) v.postDelayed({ showFocusedField() }, 250)
            keyboard = open
            WindowInsets.CONSUMED
        }
    }

    /** The field the keyboard is typing into, scrolled to the middle of what's left of the screen. */
    private fun showFocusedField() {
        web?.evaluateJavascript(
            "(function(e){if(e&&e!==document.body&&e.scrollIntoView)e.scrollIntoView({block:'center',behavior:'smooth'});})(document.activeElement)",
            null,
        )
    }

    /** The status and navigation bars in the page's color, with icons that show on it. */
    @Suppress("DEPRECATION")
    private fun systemBars(color: Int, light: Boolean) {
        window.statusBarColor = color
        window.navigationBarColor = color
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val both = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (light) both else 0, both)
        } else {
            var flags = window.decorView.systemUiVisibility
            flags = if (light) flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR else flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                flags = if (light) flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
            }
            window.decorView.systemUiVisibility = flags
        }
    }

    companion object {
        /** the welcome screen's opening plays once a run, not on coming back to it */
        private var welcomed = false

        /** the hash route a tapped notification opens (see WispMessagingService) */
        const val ROUTE = "route"

        private const val PICK_FILES = 1
        private const val ASK_MIC = 2
        private const val ASK_NOTIFICATIONS = 3
        /** the web app's dark page (apps/web/src/index.css) */
        private val DARK_BG = Color.parseColor("#121212")

        /**
         * Runs in the page before its own scripts: marks it as the Android app (for CSS), notes the file names of
         * download links (a blob: download doesn't carry one to the app), and reports light/dark to the app.
         */
        private const val SHELL_SCRIPT = """
(function(){
  if (window.__bubbleShell) return; window.__bubbleShell = 1;
  var names = window.__bubbleDownloads = {};
  var note = function(a){ if (a && a.href && a.hasAttribute('download')) names[a.href] = a.getAttribute('download') || ''; };
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){ note(this); return click.apply(this, arguments); };
  document.addEventListener('click', function(e){ note(e.target && e.target.closest && e.target.closest('a[download]')); }, true);
  var sent = '';
  var send = window.__bubbleTheme = function(force){
    var root = document.documentElement; if (!root || !window.WispAndroid) return;
    var meta = document.querySelector('meta[name="theme-color"]');
    var mode = root.dataset.mode || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var now = mode + ' ' + (meta ? meta.content : '');
    if (now === sent && force !== true) return; sent = now;
    WispAndroid.theme(mode, meta ? meta.content : '');
  };
  var watch = function(){
    var root = document.documentElement; if (!root) return;
    root.dataset.shell = 'android';
    new MutationObserver(function(){ send(); }).observe(root, { attributes: true, attributeFilter: ['data-mode'] });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) new MutationObserver(function(){ send(); }).observe(meta, { attributes: true });
    send(true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){ send(); });
})();
"""
    }
}
