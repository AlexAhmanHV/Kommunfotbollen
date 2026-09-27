import Image from "next/image";

export function SiteFooter() {
  return (
    <footer className="border-t border-line-dark bg-surface-dark py-8 text-on-dark">
      <div className="mx-auto flex max-w-5xl items-center justify-center px-4">
        <a
          href="https://alexahman.se"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-2 text-on-dark-muted transition-colors hover:text-on-dark"
        >
          <Image
            src="/alexahman-logo.svg"
            alt="AlexAhman"
            width={28}
            height={28}
            className="rounded-md"
          />
          <span className="text-xs">Skapad av AlexAhman</span>
        </a>
      </div>
    </footer>
  );
}
