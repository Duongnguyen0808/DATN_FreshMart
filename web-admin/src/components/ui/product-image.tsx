export function ProductImage({ src, name, size = 'sm' }: { src?: string | null; name: string; size?: 'sm' | 'md' }) {
  return <span className={`product-image product-image-${size}`} aria-label={name} title={name}>
    {src ? <img src={src} alt="" loading="lazy" /> : <span aria-hidden="true">{name.trim().slice(0, 1) || 'S'}</span>}
  </span>;
}

export function ProductIdentity({ name, code, imageUrl }: { name: string; code?: string | null; imageUrl?: string | null }) {
  return (
    <div className="product-identity" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <ProductImage src={imageUrl} name={name} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <strong style={{ display: 'block', lineHeight: 1.3 }}>{name}</strong>
        {code && <small style={{ display: 'block', lineHeight: 1.25 }}>{code}</small>}
      </span>
    </div>
  );
}
