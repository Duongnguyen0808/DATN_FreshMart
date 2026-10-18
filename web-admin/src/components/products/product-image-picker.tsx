'use client';
import { useEffect, useState } from 'react';

type Props = { currentUrl?: string | null };

export function ProductImagePicker({ currentUrl }: Props) {
  const [preview, setPreview] = useState(currentUrl || '');
  const [picked, setPicked] = useState(false);

  useEffect(() => { setPreview(currentUrl || ''); setPicked(false); }, [currentUrl]);
  useEffect(() => () => { if (preview.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  return <section className="product-image-picker" aria-label="Ảnh sản phẩm">
    <div className="product-image-preview">
      {preview ? <img src={preview} alt="Ảnh xem trước của sản phẩm"/> : <span>Chưa có ảnh</span>}
    </div>
    <div>
      <label className="image-upload-button">Chọn ảnh
        <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={event => {
          const file = event.target.files?.[0];
          if (!file) { setPreview(currentUrl || ''); setPicked(false); return; }
          setPreview(URL.createObjectURL(file));
          setPicked(true);
        }}/>
      </label>
      <p>JPG, PNG, WEBP hoặc AVIF · tối đa 5 MB. Ảnh được tự thu nhỏ và nén khi lưu.</p>
      {currentUrl && !picked && <label className="remove-image"><input name="removeImage" type="checkbox" value="true" onChange={event => setPreview(event.target.checked ? '' : currentUrl)}/> Xóa ảnh hiện tại</label>}
    </div>
  </section>;
}
