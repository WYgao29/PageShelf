import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

Object.defineProperty(window, "innerWidth", {
  configurable: true,
  writable: true,
  value: 1440,
});

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
    addListener() {},
    removeListener() {},
  })) as typeof window.matchMedia;
}

if (typeof HTMLDialogElement !== "undefined") {
  const prototype = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof prototype.showModal !== "function") {
    prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof prototype.close !== "function") {
    prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--sidebar-width");
  document.documentElement.style.removeProperty("--list-width");
  document.documentElement.classList.remove("resizing");
});
