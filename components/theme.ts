"use client";

// Light is the default. Dark mode is a choice each person makes, kept in this browser.
import { useEffect, useState } from "react";

const KEY = "halden-theme";

/** Runs in <head> before paint so a dark-mode choice doesn't flash light first. */
export const THEME_BOOT = `try{if(localStorage.getItem("${KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export function useDarkMode(): [boolean, (on: boolean) => void] {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try { setDark(localStorage.getItem(KEY) === "dark"); } catch { /* storage blocked: stay light */ }
  }, []);
  useEffect(() => {
    if (dark) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
  }, [dark]);
  const set = (on: boolean) => {
    setDark(on);
    try { if (on) localStorage.setItem(KEY, "dark"); else localStorage.removeItem(KEY); } catch { /* not saved */ }
  };
  return [dark, set];
}
