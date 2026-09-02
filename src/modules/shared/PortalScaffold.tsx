export function Head({
  label,
  title,
  copy,
}: {
  label: string;
  title: string;
  copy: string;
}) {
  return (
    <section className="page-head portal-head">
      <div>
        <p className="eyebrow">{label}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
    </section>
  );
}

export function Stats({ data }: { data: string[][] }) {
  return (
    <div className="metrics">
      {data.map((x) => (
        <article key={x[1]}>
          <b>{x[0]}</b>
          <span>{x[1]}</span>
        </article>
      ))}
    </div>
  );
}
