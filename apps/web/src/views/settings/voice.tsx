import { useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { Button, Input } from "../../components/ui.tsx";
import { createSpeaker, DEFAULT_VOICE, inDesktopApp, type VoiceSettings, type VoiceSpeaker } from "../../voice/providers.ts";
import { Card, Row, Select } from "./parts.tsx";

type Result = { ok: boolean; text: string } | null;
const MIC_SECONDS = 3;

/** Listen to the microphone for a few seconds and say plainly whether it picked anything up. */
function useMicTest() {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<Result>(null);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  const start = async () => {
    cleanup.current();
    setResult(null); setLevel(0);
    if (!navigator.mediaDevices?.getUserMedia) { setResult({ ok: false, text: "Microphone needs a secure connection (HTTPS or localhost)." }); return; }
    let stopped = false, frame = 0, timer: ReturnType<typeof setTimeout> | undefined, stream: MediaStream | undefined, context: AudioContext | undefined;
    const finish = (r?: Result) => {
      if (stopped) return;
      stopped = true; cancelAnimationFrame(frame); clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close().catch(() => {});
      setTesting(false); setLevel(0);
      if (r) setResult(r);
    };
    cleanup.current = () => finish();
    setTesting(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      context = new AudioContext();
      await context.resume();
      if (stopped) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let peak = 0;
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((n, v) => n + v * v, 0) / data.length);
        peak = Math.max(peak, rms);
        setLevel(Math.min(1, rms * 7));
        frame = requestAnimationFrame(tick);
      };
      tick();
      timer = setTimeout(() => finish(peak > 0.01 ? { ok: true, text: "Your microphone works." } : { ok: false, text: "We couldn't hear anything. Check that the right microphone is selected." }), MIC_SECONDS * 1000);
    } catch (e) {
      const name = (e as Error).name;
      finish({ ok: false, text: name === "NotAllowedError" || name === "SecurityError" ? "Microphone access is blocked. Allow it in your browser's site settings." : name === "NotFoundError" ? "We couldn't find a microphone. Plug one in and try again." : "We couldn't use the microphone. Check that no other app is using it." });
    }
  };
  return { testing, level, result, start };
}

function useSpeakerTest(engine: VoiceSettings["speak"]) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const speaker = useRef<VoiceSpeaker | null>(null);
  const run = useRef(0);
  useEffect(() => () => { run.current++; speaker.current?.cancel(); }, []);
  const start = async () => {
    const current = ++run.current;
    speaker.current?.cancel();
    setTesting(true); setResult(null);
    try {
      speaker.current = createSpeaker(engine, undefined, "test");
      await speaker.current.speak("Hello! This is how your agents will sound.", () => {});
      if (current === run.current) setResult({ ok: true, text: "Did you hear it? If not, check your volume." });
    } catch (e) { if (current === run.current) setResult({ ok: false, text: (e as Error).message }); }
    finally { if (current === run.current) setTesting(false); }
  };
  return { testing, result, start };
}

function Outcome({ result }: { result: Result }) {
  return <p role="status" className={result ? `text-xs ${result.ok ? "text-muted" : "text-bad"}` : "sr-only"}>{result?.text}</p>;
}

const ENGINE: Record<string, string> = { device: "On this device", openai: "OpenAI", elevenlabs: "ElevenLabs" };

/** What the Voice row says: the engine that speaks. */
export function VoiceValue() {
  const [speak, setSpeak] = useState<string | null>(null);
  useEffect(() => { api<VoiceSettings>("GET", "/api/voice/settings").then((s) => setSpeak(s.speak), () => {}); }, []);
  return <>{speak ? (ENGINE[speak] ?? speak) : ""}</>;
}

export function VoicePage() {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [loaded, setLoaded] = useState(false);
  // the settings as the hub has them (loaded or last saved): whether a key is still needed comes from these, not from what's typed
  const [saved, setSaved] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const mic = useMicTest();
  const speakerTest = useSpeakerTest(settings.speak);
  useEffect(() => { api<VoiceSettings>("GET", "/api/voice/settings").then((s) => { setSettings(s); setSaved(s); setLoaded(true); }, (e) => setMessage(e.message)); }, []);
  const save = async () => {
    setSaving(true); setMessage("");
    try { const next = await api<VoiceSettings>("PUT", "/api/voice/settings", settings); setSettings(next); setSaved(next); setMessage("Saved"); }
    catch (e) { setMessage((e as Error).message); }
    finally { setSaving(false); }
  };
  // the engines come from the draft (picking OpenAI asks for its key right away); whether a key exists comes from the hub
  const listen = inDesktopApp() ? "openai" : settings.listen; // the draft choice: picking OpenAI asks for its key right away
  const needOpenai = (listen === "openai" || settings.speak === "openai") && !saved.openaiKey;
  const needEleven = settings.speak === "elevenlabs" && !saved.elevenlabsKey;
  // a key's field shows once its engine is picked (or a key is already saved, so it can be changed)
  const usesOpenai = listen === "openai" || settings.speak === "openai" || !!saved.openaiKey;
  const usesEleven = settings.speak === "elevenlabs" || !!saved.elevenlabsKey;
  return <div className="space-y-4">
    <Card>
      <Row label="Listening"><Select label="Listening engine" disabled={!loaded} value={listen} onChange={(listen) => setSettings({ ...settings, listen: listen as VoiceSettings["listen"] })}>{!inDesktopApp() && <option value="device">On this device</option>}<option value="openai">OpenAI (online)</option></Select></Row>
      <Row label="Speaking"><Select label="Speaking engine" disabled={!loaded} value={settings.speak} onChange={(speak) => setSettings({ ...settings, speak: speak as VoiceSettings["speak"] })}><option value="device">On this device</option><option value="openai">OpenAI (online)</option><option value="elevenlabs">ElevenLabs (online)</option></Select></Row>
      {usesOpenai && <Row label={needOpenai ? "OpenAI key (needed)" : "OpenAI key"}><Input aria-label="OpenAI API key" type="password" autoComplete="off" disabled={!loaded} value={settings.openaiKey} onChange={(e) => setSettings({ ...settings, openaiKey: e.target.value })} /></Row>}
      {usesEleven && <Row label={needEleven ? "ElevenLabs key (needed)" : "ElevenLabs key"}><Input aria-label="ElevenLabs API key" type="password" autoComplete="off" disabled={!loaded} value={settings.elevenlabsKey} onChange={(e) => setSettings({ ...settings, elevenlabsKey: e.target.value })} /></Row>}
    </Card>
    <div className="flex items-center gap-3">
      <Button variant="primary" disabled={!loaded || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
    </div>
    <Card>
      <Row label="Microphone" hint={(mic.testing || mic.result) && <>
        {mic.testing && <span className="mt-1.5 block h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-chip" aria-hidden><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(mic.level * 100)}%` }} /></span>}
        <Outcome result={mic.result} />
      </>}><Button disabled={mic.testing} onClick={mic.start}>{mic.testing ? "Listening…" : "Test microphone"}</Button></Row>
      <Row label="Speaker" hint={speakerTest.result && <Outcome result={speakerTest.result} />}><Button disabled={speakerTest.testing} onClick={speakerTest.start}>{speakerTest.testing ? "Playing…" : "Test speaker"}</Button></Row>
    </Card>
  </div>;
}
