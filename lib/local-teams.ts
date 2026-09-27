// Lagen från Västerviks kommun med omnejd som sajten bevakar.
// Markeras i tabeller och matchlistor, och listas på startsidan.
export const LOCAL_TEAM_IDS = new Set([
  "eswidget-9925", // IFK Västervik (Div 3 nordöstra Götaland)
  "eswidget-10040", // Hjorted/Totebo (Div 4 Småland norra)
  "eswidget-51390", // Tjust IF FF (Div 4 Småland norra)
  "eswidget-9942", // Västerviks FF (Div 4 Småland norra)
  "eswidget-23106", // B.O.IF (Div 5 Småland nordöstra)
  "eswidget-10039", // Gunnebo IF (Div 6 Vimmerby)
  "eswidget-224214", // FC Örbäcken (Div 6 Vimmerby)
  "eswidget-10249", // Överums IK (Div 6 Vimmerby)
  "eswidget-9982", // Ankarsrums IS (Div 6 Vimmerby)
  "eswidget-191798", // Västerviks damfotboll IF (Div 3 Småland sydöstra, dam)
]);

export function isLocalTeam(teamId: string): boolean {
  return LOCAL_TEAM_IDS.has(teamId);
}

// Fast prioritetsordning för "Veckans match" när ingen derby avgör
// (se lib/matchday.ts pickFeatured). Satt av produktägaren 2026-09-27.
export const FEATURED_PRIORITY: readonly string[] = [
  "eswidget-9925", // IFK Västervik
  "eswidget-9942", // Västerviks FF
  "eswidget-10040", // Hjorted/Totebo
  "eswidget-51390", // Tjust IF FF
  "eswidget-10039", // Gunnebo IF
  "eswidget-23106", // B.O.IF
  "eswidget-191798", // Västerviks damfotboll IF
  "eswidget-10249", // Överums IK
  "eswidget-9982", // Ankarsrums IS
  "eswidget-224214", // FC Örbäcken
];

// Namnvarianter för nyhetsmatchning (gemener; matchas som delsträng i
// rubrik + ingress). Hålls avsiktligt strama: "gunnebo" ensamt är ett
// företag, "ankarsrum" ett hushållsmaskinmärke, "tjust" en hel bygd —
// hellre missa en artikel än fylla sajten med brus.
export const TEAM_NEWS_ALIASES: Record<string, string[]> = {
  "eswidget-9925": ["ifk västervik"],
  "eswidget-10040": ["hjorted/totebo", "hjorted-totebo", "hjorteds sk", "totebo aik"],
  "eswidget-51390": ["tjust if"],
  "eswidget-9942": ["västerviks ff", "västervik ff", "vff"],
  "eswidget-23106": [
    "boif",
    "b.o.if",
    "b.o. if",
    "blackstad odensvi",
    "blackstad/odensvi",
    "blackstad-odensvi",
  ],
  "eswidget-10039": ["gunnebo if"],
  "eswidget-224214": ["örbäcken"],
  "eswidget-10249": ["överums ik", "överums if"],
  "eswidget-9982": ["ankarsrums is", "ankarsrums if"],
  "eswidget-191798": ["västerviks damfotboll", "västervik dam", "västerviks dam"],
};
