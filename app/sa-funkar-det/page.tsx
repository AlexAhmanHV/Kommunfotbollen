import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Så funkar det | Kommunfotbollen",
  description:
    "Hur Kommunfotbollen hämtar tabeller, resultat, nyheter och poddar för lokalfotbollen i Västervik med omnejd, och hur ofta det uppdateras.",
};

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="reveal border-t border-neutral-800 py-8 first:border-t-0">
      <p className="mb-1 font-mono text-xs uppercase tracking-widest text-emerald-500/70">
        {eyebrow}
      </p>
      <h2 className="mb-3 text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-neutral-300">
        {children}
      </div>
    </section>
  );
}

export default function SaFunkarDet() {
  return (
    <div className="space-y-2">
      <header className="pb-4">
        <p className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
          Om sajten
        </p>
        <h1 className="text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          Så funkar det
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-neutral-400">
          Kommunfotbollen samlar tabeller, resultat, nyheter och poddar för
          fotbollen i Västervik med omnejd på ett ställe, och håller det
          uppdaterat automatiskt. Här är vad som händer bakom kulisserna.
        </p>
      </header>

      <Section eyebrow="Data" title="Tabeller, matcher och resultat">
        <p>
          All sportdata hämtas från Everysport, som i sin tur bygger på
          samma officiella källa som svenskfotboll.se. Sajten följer fyra
          serier som kommunens lag spelar i, från Division 3 ner till
          Division 6, och lyfter fram de lokala lagen med tydlig accentfärg i
          tabeller och matchlistor.
        </p>
        <p>
          Tabeller, resultat och målskyttar synkas automatiskt en gång per
          dygn, <strong>kl 23:00</strong> efter kvällens matcher, utan att
          någon behöver göra något manuellt.
        </p>
      </Section>

      <Section eyebrow="Nyheter" title="Artiklar från lokaltidningarna">
        <p>
          Nyheterna kommer från de tre tidningar som faktiskt bevakar de här
          lagen: <strong>Dagens Västervik</strong>,{" "}
          <strong>Västerviks-Tidningen</strong> och{" "}
          <strong>Vimmerby Tidning</strong>. Sajten går igenom deras
          fotbollsartiklar en gång om dygnet och kopplar varje artikel till
          rätt lag.
        </p>
        <p>
          Bara rubrik, kort ingress och en länk sparas. Själva läsningen
          sker alltid hos tidningen. De senaste artiklarna visas direkt,
          äldre ligger bakom &quot;visa mer&quot;.
        </p>
      </Section>

      <Section eyebrow="AI" title="Relevansfiltret">
        <p>
          Lokaltidningarna skriver om mycket mer än de här lagen: speedway,
          hockey, debattartiklar. För att hålla nyhetsflödet rent bedöms
          varje ny artikel av en AI-modell som avgör om den verkligen handlar
          om det aktuella lagets fotboll.
        </p>
        <p>
          Artiklar som inte håller måttet göms. Filtret körs bara på nya
          artiklar, och vid tveksamhet får artikeln vara kvar hellre än att
          något viktigt missas. Det finjusteras fortfarande.
        </p>
      </Section>

      <Section eyebrow="Poddar" title="Nykritat & Fotbollsviken">
        <p>
          De två poddar som täcker kommunfotbollen samlas här:{" "}
          <strong>Nykritat</strong> (nya avsnitt på torsdagar) och{" "}
          <strong>Fotbollsviken</strong> (fredagar). De tre senaste avsnitten
          av varje visas, med länk vidare till podden. Äldre avsnitt ligger
          bakom &quot;visa mer&quot;.
        </p>
      </Section>

      <Section eyebrow="Kort sagt" title="Automatiskt, alltid färskt">
        <p>
          Hela poängen är att slippa leta på fem ställen. Sajten hämtar,
          filtrerar och sorterar själv, och ger dig en samlad bild av
          lokalfotbollen som alltid är uppdaterad.
        </p>
        <p className="pt-2">
          <Link
            href="/"
            className="font-mono text-xs text-emerald-400 hover:text-emerald-300"
          >
            ← Tillbaka till startsidan
          </Link>
        </p>
      </Section>
    </div>
  );
}
