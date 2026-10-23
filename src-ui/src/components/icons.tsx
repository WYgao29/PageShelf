type IconName = "library" | "folder" | "series" | "chevron" | "more" | "grip" | "search" | "close" | "settings" | "refresh" | "plus" | "sidebar" | "check" | "alert" | "chevron-down";

export function Icon({ name }: { name: IconName }) {
  const nav = name === "library" || name === "folder" || name === "series";
  return (
    <svg className={nav ? "nav-icon" : "icon"} viewBox="0 0 24 24" aria-hidden="true">
      {name === "library" ? (
        <>
          <path d="M4 5.5h12.5A2.5 2.5 0 0 1 19 8v11H7.5A2.5 2.5 0 0 1 5 16.5V6" />
          <path d="M8 5.5V16" />
        </>
      ) : null}
      {name === "folder" ? <path d="M3.5 7.5h6l2 2H20.5v9H3.5v-11Z" /> : null}
      {name === "series" ? (
        <>
          <path d="M6 7h14" />
          <path d="M6 12h14" />
          <path d="M6 17h10" />
        </>
      ) : null}
      {name === "chevron" ? <path d="m9 6 6 6-6 6" /> : null}
      {name === "chevron-down" ? <path d="m7 10 5 5 5-5" /> : null}
      {name === "search" ? <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></> : null}
      {name === "close" ? <path d="m6 6 12 12M18 6 6 18" /> : null}
      {name === "settings" ? <><path d="m9 4 1-2h4l1 2 2 1 2-.2 2 3.4-1.2 1.8v2L21 14l-2 3.4-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2L3 14l1.2-1.8v-2L3 8.4 5 5l2 .2Z" /><circle cx="12" cy="11" r="3" /></> : null}
      {name === "refresh" ? <><path d="M19 8a7.5 7.5 0 1 0 1 7M19 3v5h-5" /></> : null}
      {name === "plus" ? <path d="M12 5v14M5 12h14" /> : null}
      {name === "sidebar" ? <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M5.5 8h1M5.5 11h1" /></> : null}
      {name === "check" ? <path d="m5 12 4 4L19 6" /> : null}
      {name === "alert" ? <><path d="m10.4 4.5-8 14A1 1 0 0 0 3.3 20h17.4a1 1 0 0 0 .9-1.5l-8-14a1.8 1.8 0 0 0-3.2 0Z" /><path d="M12 9v4M12 16h.01" /></> : null}
      {name === "more" ? (
        <>
          <circle cx="6" cy="12" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="18" cy="12" r="1.2" />
        </>
      ) : null}
      {name === "grip" ? (
        <>
          <circle cx="9" cy="7" r="1" />
          <circle cx="15" cy="7" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="9" cy="17" r="1" />
          <circle cx="15" cy="17" r="1" />
        </>
      ) : null}
    </svg>
  );
}
