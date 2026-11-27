"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { recordTime } from "@/lib/store";
import type { Employee, ShiftCode, TimeRecord } from "@/lib/types";
import { formatDuration, formatInstant, localToIso, spanMinutes } from "@/lib/time";
import { Button, Dialog, Icon } from "@/components/ui";
import { formatCoords, useNow } from "./shared";

// The single-file preview runs in a sandbox with no camera or GPS. It sets this flag so the flow
// can still be clicked through with a chosen photo and the office location. The Next.js app never does.
const DEMO = process.env.NEXT_PUBLIC_DEMO_FALLBACKS === "true";
const DEMO_GPS = { latitude: 14.5547, longitude: 121.0244, accuracy_m: 12 };

type Step<T> = { state: "idle" | "working" | "ready" | "error"; value?: T; error?: string };

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${os} · ${br}`;
}

export function RecordTimeDialog({ employee, shift, kind, workDate, onClose, onDone }: {
  employee: Employee;
  shift: ShiftCode;
  kind: TimeRecord["kind"];
  workDate: string;
  onClose: () => void;
  onDone: (r: TimeRecord) => void;
}) {
  const now = useNow(true);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<Step<null>>({ state: "idle" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [gps, setGps] = useState<Step<{ latitude: number; longitude: number; accuracy_m: number }>>({ state: "idle" });
  const [submitError, setSubmitError] = useState("");

  const stopCamera = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };

  const startCamera = useCallback(async () => {
    setPhoto(null);
    setCamera({ state: "working" });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
      setCamera({ state: "ready" });
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setCamera({ state: "error", error: denied ? "Camera access is blocked. Allow it in your browser’s site settings, then try again." : "We couldn’t find a camera on this device." });
    }
  }, []);

  const locate = useCallback(() => {
    setGps({ state: "working" });
    if (!navigator.geolocation) { setGps({ state: "error", error: "This browser can’t share location." }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ state: "ready", value: { latitude: +p.coords.latitude.toFixed(6), longitude: +p.coords.longitude.toFixed(6), accuracy_m: Math.round(p.coords.accuracy) } }),
      (e) => setGps({ state: "error", error: e.code === e.PERMISSION_DENIED ? "Location access is blocked. Allow it in your browser’s site settings, then try again." : "We couldn’t get a GPS fix. Move near a window and try again." }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    startCamera();
    locate();
    return stopCamera;
  }, [startCamera, locate]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    const size = Math.min(v.videoWidth, v.videoHeight);
    c.width = c.height = 360;
    c.getContext("2d")!.drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, 360, 360);
    setPhoto(c.toDataURL("image/jpeg", 0.8));
    stopCamera();
  };

  const fromFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const size = Math.min(img.width, img.height);
      c.width = c.height = 360;
      c.getContext("2d")!.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 360, 360);
      setPhoto(c.toDataURL("image/jpeg", 0.8));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };

  const retake = () => { setPhoto(null); startCamera(); };
  const ready = !!photo && gps.state === "ready";
  const shiftEnd = Date.parse(localToIso(workDate, shift.start_time, shift.timezone)) + spanMinutes(shift) * 60000;
  const early = kind === "clock_out" ? Math.round((shiftEnd - now) / 60000) : 0;
  const verb = kind === "clock_in" ? "time in" : "time out";

  const submit = () => {
    try {
      const rec = recordTime({ employeeId: employee.id, kind, photo: photo!, ...gps.value!, device: deviceLabel() });
      stopCamera();
      onDone(rec);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Couldn’t record your time. Try again.");
    }
  };

  return (
    <Dialog
      title={`Record ${verb}`}
      description="Your photo, location and the time are all saved with this record."
      onClose={() => { stopCamera(); onClose(); }}
      footer={
        <>
          {!ready && <span className="foot-hint">{!photo ? "Take a photo to continue." : "Waiting for your location."}</span>}
          <Button variant="ghost" onClick={() => { stopCamera(); onClose(); }}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>Record {verb}</Button>
        </>
      }
    >
      <div className="capture">
        <div className="capture-photo">
          {photo ? (
            <img src={photo} alt="Your photo for this record" />
          ) : (
            <>
              <video ref={video} playsInline muted aria-label="Camera preview" className={camera.state === "ready" ? "" : "hidden"} />
              {camera.state !== "ready" && (
                <div className="capture-placeholder">
                  <Icon name="camera" size={28} />
                  <p>{camera.state === "error" ? camera.error : "Starting camera…"}</p>
                </div>
              )}
            </>
          )}
        </div>
        <div className="capture-actions">
          {photo ? (
            <Button size="sm" icon="camera" onClick={retake}>Retake photo</Button>
          ) : camera.state === "ready" ? (
            <Button size="sm" variant="primary" icon="camera" onClick={capture}>Take photo</Button>
          ) : camera.state === "error" ? (
            <>
              <Button size="sm" onClick={startCamera}>Try camera again</Button>
              {DEMO && (
                <label className="btn btn-ghost btn-sm file-btn">
                  <input type="file" accept="image/*" capture="user" onChange={fromFile} />
                  Choose a photo (preview only)
                </label>
              )}
            </>
          ) : null}
        </div>

        <ul className="proofs" aria-label="Required for this record">
          <li className="proof proof-ok">
            <Icon name="clock" size={18} />
            <span className="proof-label">Time</span>
            <span className="proof-value num">{formatInstant(new Date(now).toISOString(), shift.timezone)} <span className="muted">· stamped by the server</span></span>
          </li>
          <li className={`proof ${photo ? "proof-ok" : ""}`}>
            <Icon name="camera" size={18} />
            <span className="proof-label">Photo</span>
            <span className="proof-value">{photo ? "Captured" : <span className="muted">Not taken yet</span>}</span>
          </li>
          <li className={`proof ${gps.state === "ready" ? "proof-ok" : gps.state === "error" ? "proof-err" : ""}`}>
            <Icon name="pin" size={18} />
            <span className="proof-label">Location</span>
            <span className="proof-value">
              {gps.state === "ready" && gps.value && <span className="num">{formatCoords(gps.value.latitude, gps.value.longitude)} <span className="muted">· within {gps.value.accuracy_m} m</span></span>}
              {gps.state === "working" && <span className="muted">Getting your location…</span>}
              {gps.state === "error" && (
                <span className="proof-error">
                  <span className="text-danger">{gps.error}</span>
                  <span className="proof-error-actions">
                    <button type="button" className="link" onClick={locate}>Try again</button>
                    {DEMO && <button type="button" className="link" onClick={() => setGps({ state: "ready", value: DEMO_GPS })}>Use office location (preview only)</button>}
                  </span>
                </span>
              )}
            </span>
          </li>
        </ul>
        {early > 0 && (
          <p className="callout-warn" role="note">
            Your shift ends at {formatInstant(new Date(shiftEnd).toISOString(), shift.timezone)}. Timing out now leaves {formatDuration(early)} of the shift unworked, and HR will see it as undertime.
          </p>
        )}
        {submitError && <p className="text-danger" role="alert">{submitError}</p>}
      </div>
    </Dialog>
  );
}
