import Image from "next/image";

// Lagemblem: riktig Everysport-logo när den finns, annars ett monogram med
// lagets initialer i palettens orange ton. Garanterar att varje lag har ett
// konsekvent märke utan trasiga bilder eller licensproblem.

function initials(name: string): string {
  const words = name
    .replace(/[./]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function TeamCrest({
  name,
  logoUrl,
  size = 28,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-neutral-800"
        style={{ width: size, height: size }}
      >
        <Image
          src={logoUrl}
          alt={`${name} logotyp`}
          width={size}
          height={size}
          className="h-full w-full object-contain p-0.5"
        />
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-brand/30 bg-brand/15 font-mono font-semibold text-neutral-100"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
