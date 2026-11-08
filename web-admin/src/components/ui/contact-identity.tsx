export function ContactIdentity({ name, detail, company = false }: { name: string; detail?: string | null; company?: boolean }) {
  const initials = name.trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toLocaleUpperCase('vi-VN');
  const tone = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  return <div className="contact-identity"><span className={`contact-monogram contact-color-${tone}${company ? ' company' : ''}`} aria-hidden="true">{initials}</span><span><strong>{name}</strong>{detail && <small>{detail}</small>}</span></div>;
}
