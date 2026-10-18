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
  if (identifierColumn(header)) return name.includes('barcode') ? 20 : 17;
  const maxLength = Math.max(header.length, ...values.map(value => value.length));
  if (/ghi chu|nguyen nhan|dia chi|san pham|nha cung cap|doi tac/.test(name)) return Math.min(46, Math.max(22, maxLength + 2));
  if (/trang thai|ket qua|danh gia|loai|don vi/.test(name)) return Math.min(24, Math.max(14, maxLength + 2));
  return Math.min(38, Math.max(13, maxLength + 2));
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
            cell.numFmt = percentage ? (explicitPercent ? '0.00%' : '#,##0.00"%"') : '#,##0.##';
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
