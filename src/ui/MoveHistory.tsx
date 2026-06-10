/**
 * Move history shown as numbered pairs (White move / Black move), oldest at
 * the top. Renders purely from the SAN list in the snapshot.
 */
export function MoveHistory({ history }: { history: string[] }) {
  const rows: { number: number; white: string; black: string | null }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({
      number: i / 2 + 1,
      white: history[i],
      black: history[i + 1] ?? null,
    });
  }

  return (
    <div className="panel history">
      <h2 className="panel__title">Moves</h2>
      {rows.length === 0 ? (
        <p className="panel__hint">No moves yet.</p>
      ) : (
        <ol className="history__list">
          {rows.map((row) => (
            <li key={row.number} className="history__row">
              <span className="history__num">{row.number}.</span>
              <span className="history__ply">{row.white}</span>
              <span className="history__ply">{row.black ?? ''}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
