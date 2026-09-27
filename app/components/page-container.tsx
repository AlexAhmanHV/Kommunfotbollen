// Standardbehållaren med lugn läsbredd som tidigare låg i <main> i layouten.
// Startsidan har egna zoner som går kant i kant och använder den inte.
export function PageContainer({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-4xl px-4 py-8 ${className}`}>{children}</div>;
}
