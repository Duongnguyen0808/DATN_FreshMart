function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = csv.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted && character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(values => values.some(value => value.trim() !== ''));
}

const plain = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const isNumber = (value: string) => /^-?(?:\d+|\d{1,3}(?:[., ]\d{3})+)(?:[.,]\d+)?%?$/.test(value.trim());
const identifierColumn = (header: string) => /\b(ma|barcode|sku|code|id|phone|dien thoai|so dien thoai)\b/.test(plain(header));
const numberValue = (value: string) => {
  const clean = value.trim().replace(/%$/, '').replaceAll(' ', '');
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(clean)) return Number(clean.replaceAll('.', '').replace(',', '.'));
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(clean)) return Number(clean.replaceAll(',', ''));
  return Number(clean.replace(',', '.'));
};

function findHeaderIndex(rows: string[][]) {
  return rows.findIndex((row, index) => row.length >= 3 && !(index === 0 && row.length === 1) && row.filter(value => value.trim() && !isNumber(value)).length >= Math.min(3, row.length));
}

function columnWidth(values: string[], header: string) {
  const name = plain(header);
  if (identifierColumn(header)) return name.includes('barcode') ? 22 : 18;
  const maxLength = Math.max(header.length, ...values.map(value => value.length));
  if (/ghi chu|nguyen nhan|dia chi|san pham|nha cung cap|doi tac/.test(name)) return Math.min(48, Math.max(26, maxLength + 5));
  if (/trang thai|ket qua|danh gia|loai|don vi|danh muc/.test(name)) return Math.min(28, Math.max(16, maxLength + 5));
  if (/gia|tien|doanh thu|chi phi|ton|so luong|chiet khau/.test(name)) return Math.min(26, Math.max(18, maxLength + 6));
  return Math.min(40, Math.max(16, maxLength + 5));
}

function estimateRowHeight(values: string[], widths: number[]) {
  const lines = Math.max(1, ...values.map((value, index) => Math.ceil(value.length / Math.max(8, widths[index] - 2))));
  return Math.min(84, Math.max(23, 7 + lines * 15));
}

/** Xuất workbook XLSX có AutoFilter, cố định header, tự căn độ rộng cột và chiều cao dòng. */
export async function createExcelBuffer(csv: string) {
  const rows = parseCsv(csv);
  if (!rows.length) return new Uint8Array();
  const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FreshMart';
    workbook.created = new Date();
    workbook.subject = 'Báo cáo vận hành';
    const headerIndex = findHeaderIndex(rows);
    const count = Math.max(1, ...rows.map(row => row.length));
    const headers = headerIndex >= 0 ? rows[headerIndex] : [];
    const widths = Array.from({ length: count }, (_, index) => columnWidth(rows.map(row => row[index] ?? ''), headers[index] ?? ''));
    const sheet = workbook.addWorksheet('Báo cáo', {
      views: headerIndex >= 0 ? [{ state: 'frozen', ySplit: headerIndex + 1, xSplit: 0, showGridLines: false }] : [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    });
    sheet.columns = widths.map(width => ({ width, style: { font: { name: 'Arial', size: 10 }, alignment: { vertical: 'middle', wrapText: true } } }));

    rows.forEach((values, rowIndex) => {
      const valuesForRow = Array.from({ length: count }, (_, index) => values[index] ?? '');
      const excelRow = sheet.addRow(valuesForRow);
      excelRow.height = estimateRowHeight(valuesForRow, widths);
      const isTitle = rowIndex === 0 && values.length === 1;
      const isHeader = rowIndex === headerIndex;
      const isMetadata = headerIndex >= 0 && rowIndex < headerIndex;
      const isSummary = rowIndex > headerIndex && values.length === 2;
      if (isTitle) {
        sheet.mergeCells(excelRow.number, 1, excelRow.number, count);
        excelRow.height = 38;
        excelRow.getCell(1).font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF123D66' } };
        excelRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FB' } };
        excelRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
        excelRow.getCell(1).border = { bottom: { style: 'medium', color: { argb: 'FF1780C3' } } };
        return;
      }
      if (isHeader) {
        excelRow.height = 32;
        excelRow.eachCell(cell => {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF126DA5' } };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.border = { top: { style: 'thin', color: { argb: 'FF0D5A8C' } }, bottom: { style: 'thin', color: { argb: 'FF0D5A8C' } }, left: { style: 'thin', color: { argb: 'FFFFFFFF' } }, right: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
        });
        return;
      }
      excelRow.eachCell((cell, columnIndex) => {
        const raw = valuesForRow[columnIndex - 1] ?? '';
        const header = headers[columnIndex - 1] ?? '';
        const normalizedHeader = plain(header);
        const identifier = identifierColumn(header);
        const percentage = /%|phan tram|margin/.test(normalizedHeader);
        const date = /ngay|thoi diem|date/.test(normalizedHeader) && /^\d{4}-\d{2}-\d{2}$/.test(raw);
        if (!isTitle && !isHeader && !isMetadata && !isSummary && !identifier && isNumber(raw)) {
          const parsed = numberValue(raw);
          if (Number.isFinite(parsed)) {
            const explicitPercent = raw.trim().endsWith('%');
            cell.value = percentage && explicitPercent ? parsed / 100 : parsed;
            cell.numFmt = percentage ? (explicitPercent ? '0.00%' : '#,##0.00"%"') : (Number.isInteger(parsed) ? '#,##0' : '#,##0.00');
          }
        } else if (date) {
          cell.value = new Date(`${raw}T00:00:00`);
          cell.numFmt = 'dd/mm/yyyy';
        } else if (identifier) {
          cell.value = raw;
          cell.numFmt = '@';
        }
        cell.alignment = { vertical: 'middle', horizontal: isNumber(raw) && !identifier ? 'right' : isSummary && columnIndex === 2 ? 'right' : 'left', wrapText: true };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFD5DFEB' } } };
        if (isMetadata) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: columnIndex === 1 ? 'FFF2F6FA' : 'FFFFFFFF' } };
          if (columnIndex === 1) cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF52677F' } };
        } else if (isSummary) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F7FC' } };
          if (columnIndex === 1) cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF52677F' } };
          else cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF075D96' } };
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowIndex % 2 === 0 ? 'FFF4F8FC' : 'FFFFFFFF' } };
        }
      });
    });

    if (headerIndex >= 0) {
      const headerRowNumber = headerIndex + 1;
      sheet.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: sheet.rowCount, column: count } };
    }
  return workbook.xlsx.writeBuffer();
}

export async function downloadExcel(csv: string, filename: string) {
  try {
    const buffer = await createExcelBuffer(csv);
    const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename.replace(/\.[^.]+$/, '')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error('Không thể tạo tệp Excel', error);
    window.alert('Không thể xuất Excel. Vui lòng thử lại hoặc tải lại trang.');
  }
}

async function renderProductThumbnailPng(imageUrl: string | null | undefined, productName: string): Promise<string> {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);

  if (imageUrl) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.crossOrigin = 'anonymous';
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Image load error'));
        element.src = imageUrl;
      });
      const pad = 6;
      const avail = size - pad * 2;
      const scale = Math.min(avail / Math.max(1, img.naturalWidth || img.width), avail / Math.max(1, img.naturalHeight || img.height));
      const drawW = Math.round((img.naturalWidth || img.width) * scale);
      const drawH = Math.round((img.naturalHeight || img.height) * scale);
      const offsetX = Math.round((size - drawW) / 2);
      const offsetY = Math.round((size - drawH) / 2);
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      return canvas.toDataURL('image/png');
    } catch {
      // Fallback to initial badge below
    }
  }

  ctx.fillStyle = '#E6F9F6';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#0D9488';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  ctx.fillStyle = '#0F766E';
  ctx.font = 'bold 40px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((productName.trim().charAt(0) || 'S').toUpperCase(), size / 2, size / 2 + 2);
  return canvas.toDataURL('image/png');
}

export type ProductExcelRow = {
  imageUrl?: string | null;
  productName: string;
  values: (string | number)[];
};

export async function downloadProductsExcelWithImages(options: {
  title: string;
  headers: string[];
  rows: ProductExcelRow[];
  includeImageColumn: boolean;
  filename: string;
}) {
  try {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FreshMart';
    workbook.created = new Date();
    workbook.subject = options.title;

    const finalHeaders = options.includeImageColumn ? ['Ảnh sản phẩm', ...options.headers] : [...options.headers];
    const colCount = finalHeaders.length;

    const widths = finalHeaders.map((header, idx) => {
      if (options.includeImageColumn && idx === 0) return 14;
      const dataIdx = options.includeImageColumn ? idx - 1 : idx;
      const colStrings = options.rows.map(r => String(r.values[dataIdx] ?? ''));
      return columnWidth(colStrings, header);
    });

    const sheet = workbook.addWorksheet('Danh sách sản phẩm', {
      views: [{ state: 'frozen', ySplit: 3, xSplit: 0, showGridLines: true }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });

    sheet.columns = widths.map(width => ({
      width,
      style: { font: { name: 'Arial', size: 10 }, alignment: { vertical: 'middle', wrapText: true } },
    }));

    const titleRow = sheet.addRow([options.title]);
    sheet.mergeCells(1, 1, 1, colCount);
    titleRow.height = 38;
    titleRow.getCell(1).font = { name: 'Arial', size: 15, bold: true, color: { argb: 'FF0F524D' } };
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F8F3' } };
    titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    titleRow.getCell(1).border = { bottom: { style: 'medium', color: { argb: 'FF0D9488' } } };

    const metaRow = sheet.addRow(['Tổng số mặt hàng', options.rows.length, ...Array.from({ length: Math.max(0, colCount - 2) }, () => '')]);
    metaRow.height = 24;
    metaRow.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF334155' } };
    metaRow.getCell(2).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0D9488' } };
    metaRow.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };

    const headerRow = sheet.addRow(finalHeaders);
    headerRow.height = 32;
    headerRow.eachCell(cell => {
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF0D5A54' } },
        bottom: { style: 'thin', color: { argb: 'FF0D5A54' } },
        left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
        right: { style: 'thin', color: { argb: 'FFFFFFFF' } },
      };
    });

    for (let i = 0; i < options.rows.length; i += 1) {
      const item = options.rows[i]!;
      const rowCells = options.includeImageColumn ? ['', ...item.values] : [...item.values];
      const excelRow = sheet.addRow(rowCells);
      excelRow.height = options.includeImageColumn ? 46 : 26;

      excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = finalHeaders[colNumber - 1] ?? '';
        const norm = plain(header);
        const rawVal = rowCells[colNumber - 1];
        const isImgCol = options.includeImageColumn && colNumber === 1;
        const isId = identifierColumn(header);
        const isMoneyOrNum = typeof rawVal === 'number' || (!isId && !isImgCol && typeof rawVal === 'string' && isNumber(rawVal));

        if (isImgCol) {
          cell.value = '';
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (isId) {
          cell.value = String(rawVal ?? '');
          cell.numFmt = '@';
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
        } else if (isMoneyOrNum) {
          const num = typeof rawVal === 'number' ? rawVal : numberValue(String(rawVal));
          cell.value = num;
          cell.numFmt = Number.isInteger(num) ? '#,##0' : '#,##0.00';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.font = { name: 'Arial', size: 10, bold: /gia ban|ton/.test(norm) };
        } else {
          cell.value = String(rawVal ?? '');
          const centerCol = /don vi|trang thai/.test(norm);
          cell.alignment = { vertical: 'middle', horizontal: centerCol ? 'center' : 'left', wrapText: true };
        }

        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: i % 2 === 0 ? 'FFFFFFFF' : 'FFF4FBF9' },
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD5E8E4' } },
          bottom: { style: 'thin', color: { argb: 'FFD5E8E4' } },
          left: { style: 'thin', color: { argb: 'FFD5E8E4' } },
          right: { style: 'thin', color: { argb: 'FFD5E8E4' } },
        };
      });

      if (options.includeImageColumn) {
        const pngDataUrl = await renderProductThumbnailPng(item.imageUrl, item.productName);
        if (pngDataUrl) {
          const imageId = workbook.addImage({ base64: pngDataUrl, extension: 'png' });
          sheet.addImage(imageId, {
            tl: { col: 0.18, row: excelRow.number - 1 + 0.1 },
            ext: { width: 48, height: 48 },
          });
        }
      }
    }

    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: sheet.rowCount, column: colCount } };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = options.filename.toLowerCase().endsWith('.xlsx') ? options.filename : `${options.filename.replace(/\.[^.]+$/, '')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error('Không thể xuất Excel sản phẩm kèm ảnh', error);
    window.alert('Không thể xuất Excel. Vui lòng thử lại.');
  }
}
