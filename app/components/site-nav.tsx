"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TeamCrest } from "./team-crest";

type League = { id: string; name: string };
type Team = { id: string; name: string; leagueId: string; logoUrl: string | null };

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="transition-transform duration-200 group-aria-expanded:rotate-180"
      aria-hidden
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SiteNav({ leagues, teams }: { leagues: League[]; teams: Team[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(null);
        setMobileOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const close = () => {
    setOpen(null);
    setMobileOpen(false);
  };

  // Gemensam stil: grön understrykning vid hover/öppen meny.
  const itemCls =
    "group relative inline-flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-on-dark-muted transition-colors hover:text-on-dark aria-expanded:text-on-dark";
  const underline =
    "after:absolute after:-bottom-1.5 after:left-0 after:h-0.5 after:w-full after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-200 group-hover:after:scale-x-100 group-aria-expanded:after:scale-x-100";

  const leagueItems = leagues.map((l) => ({ label: l.name, href: `/serie/${l.id}` }));

  return (
    <nav ref={ref} className="flex items-center gap-4">
      {/* Desktop */}
      <div className="hidden items-center gap-6 md:flex">
        <Dropdown
          id="serier"
          label="Serier"
          open={open === "serier"}
          onToggle={() => setOpen(open === "serier" ? null : "serier")}
          itemCls={itemCls}
          underline={underline}
        >
          {leagueItems.map((l) => (
            <DropdownLink key={l.href} href={l.href} onClick={close}>
              {l.label}
            </DropdownLink>
          ))}
        </Dropdown>

        <Dropdown
          id="lag"
          label="Lag"
          open={open === "lag"}
          onToggle={() => setOpen(open === "lag" ? null : "lag")}
          itemCls={itemCls}
          underline={underline}
          wide
        >
          {teams.map((t) => (
            <DropdownLink key={t.id} href={`/serie/${t.leagueId}`} onClick={close}>
              <span className="flex items-center gap-2.5">
                <TeamCrest name={t.name} logoUrl={t.logoUrl} size={22} />
                {t.name}
              </span>
            </DropdownLink>
          ))}
        </Dropdown>

        <Link href="/#nyheter" onClick={close} className={`${itemCls} ${underline}`}>
          Nyheter
        </Link>

        <Link href="/#poddar" onClick={close} className={`${itemCls} ${underline}`}>
          Poddar
        </Link>

        <Dropdown
          id="om"
          label="Om"
          open={open === "om"}
          onToggle={() => setOpen(open === "om" ? null : "om")}
          itemCls={itemCls}
          underline={underline}
          align="right"
        >
          <DropdownLink href="/sa-funkar-det" onClick={close}>
            Så funkar det
          </DropdownLink>
          <DropdownLink href="/systemstatus" onClick={close}>
            Systemstatus
          </DropdownLink>
        </Dropdown>
      </div>

      {/* Mobil: hamburgare */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={mobileOpen ? "Stäng meny" : "Öppna meny"}
        aria-expanded={mobileOpen}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-dark text-on-dark-muted transition-colors hover:text-on-dark md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          {mobileOpen ? (
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          ) : (
            <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {mobileOpen && (
        <div className="absolute inset-x-0 top-full border-b border-line-dark bg-surface-dark md:hidden">
          <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
            <MobileGroup label="Serier">
              {leagueItems.map((l) => (
                <MobileLink key={l.href} href={l.href} onClick={close}>
                  {l.label}
                </MobileLink>
              ))}
            </MobileGroup>
            <MobileGroup label="Lag">
              {teams.map((t) => (
                <MobileLink key={t.id} href={`/serie/${t.leagueId}`} onClick={close}>
                  <span className="flex items-center gap-2.5">
                    <TeamCrest name={t.name} logoUrl={t.logoUrl} size={20} />
                    {t.name}
                  </span>
                </MobileLink>
              ))}
            </MobileGroup>
            <div className="flex flex-col gap-3 border-t border-line-dark pt-4 font-display text-base font-bold uppercase tracking-wide">
              <Link href="/#nyheter" onClick={close} className="text-on-dark hover:text-accent">
                Nyheter
              </Link>
              <Link href="/#poddar" onClick={close} className="text-on-dark hover:text-accent">
                Poddar
              </Link>
              <Link href="/sa-funkar-det" onClick={close} className="text-on-dark hover:text-accent">
                Så funkar det
              </Link>
              <Link href="/systemstatus" onClick={close} className="text-on-dark hover:text-accent">
                Systemstatus
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

function Dropdown({
  id,
  label,
  open,
  onToggle,
  children,
  itemCls,
  underline,
  wide,
  align = "left",
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  itemCls: string;
  underline: string;
  wide?: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`menu-${id}`}
        onClick={onToggle}
        className={`${itemCls} ${underline}`}
      >
        {label}
        <Chevron />
      </button>
      {open && (
        <div
          id={`menu-${id}`}
          className={`absolute top-full z-50 mt-3 max-h-[70vh] overflow-y-auto rounded-xl border border-line-dark bg-surface-dark-raised p-1.5 shadow-xl shadow-black/30 ${
            align === "right" ? "right-0" : "left-0"
          } ${wide ? "w-64" : "w-56"}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block rounded-lg px-3 py-2 text-sm text-on-dark transition-colors hover:bg-line-dark"
    >
      {children}
    </Link>
  );
}

function MobileGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-on-dark-muted">
        {label}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function MobileLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} className="rounded-lg px-2 py-2 text-sm text-on-dark hover:bg-line-dark">
      {children}
    </Link>
  );
}
