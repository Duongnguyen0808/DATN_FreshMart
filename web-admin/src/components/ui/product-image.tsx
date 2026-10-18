export function ProductImage({ src, name, size = 'sm' }: { src?: string | null; name: string; size?: 'sm' | 'md' }) {
  return <span className={`product-image product-image-${size}`} aria-label={name} title={name}>
    {src ? <img src={src} alt="" loading="lazy" /> : <span aria-hidden="true">{name.trim().slice(0, 1) || 'S'}</span>}
  </span>;
}

export function ProductIdentity({ name, code, imageUrl }: { name: string; code?: string | null; imageUrl?: string | null }) {
  return <div className="product-identity"><ProductImage src={imageUrl} name={name}/><span><strong>{name}</strong>{code && <small>{code}</small>}</span></div>;
}
