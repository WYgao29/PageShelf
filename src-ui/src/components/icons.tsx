type IconName = "library" | "folder" | "series" | "chevron" | "more" | "grip";

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
