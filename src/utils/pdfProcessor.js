// Keep Up System - PDF OCR Processor Utility
// Extracts digital-native embedded text using pdf-parse, or falls back to scanned page-by-page OCR using pdf-to-img + Tesseract.js.

const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { pdf: pdfToImg } = require('pdf-to-img');
const Tesseract = require('tesseract.js');

const PDFProcessor = {
  async extractTextFromPdf(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error('PDF file not found on disk.');
    }

    const dataBuffer = fs.readFileSync(filePath);
    
    // Check if the PDF is encrypted (by inspecting the PDF header/structure)
    // Most encrypted PDFs have '/Encrypt' in their metadata
    const isEncrypted = dataBuffer.toString('binary', 0, Math.min(dataBuffer.length, 1024 * 10)).includes('/Encrypt');
    if (isEncrypted) {
      throw new Error('Encrypted PDF documents are not supported for safety.');
    }

    // 1. Try digital-native text extraction
    let parsedText = '';
    let isDigitalTextValid = false;
    
    try {
      const parser = new PDFParse({ data: dataBuffer });
      const parsed = await parser.getText();
      await parser.destroy();
      parsedText = parsed.text || '';
      
      const minTextLength = parseInt(process.env.OCR_MIN_TEXT_LENGTH || '30', 10);
      if (parsedText.trim().length >= minTextLength) {
        isDigitalTextValid = true;
      }
    } catch (err) {
      console.warn('[PDF PROCESSOR] pdf-parse failed, falling back to scanned OCR conversion...', err.message);
    }

    if (isDigitalTextValid) {
      console.log('[PDF PROCESSOR] Text-based PDF detected. Extracted directly.');
      return parsedText;
    }

    // 2. Try scanned PDF page conversion (OCR)
    console.log('[PDF PROCESSOR] Scanned/image PDF detected. Converting pages to images...');
    
    const maxPages = parseInt(process.env.MAX_PDF_PAGES || '20', 10);
    const timeoutSeconds = parseInt(process.env.OCR_PROCESS_TIMEOUT_SECONDS || '60', 10);
    
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`PDF OCR processing timed out after ${timeoutSeconds} seconds.`));
      }, timeoutSeconds * 1000);
    });

    const ocrPromise = (async () => {
      // Scale 1.5 reduces memory footprint on node canvas page rendering
      const document = await pdfToImg(dataBuffer, { scale: 1.5 });
      let pageCount = 1;
      let combinedText = '';

      for await (const pageBuffer of document) {
        if (pageCount > maxPages) {
          console.warn(`[PDF PROCESSOR] Page count exceeds MAX_PDF_PAGES (${maxPages}). Truncating.`);
          break;
        }
        
        console.log(`[PDF PROCESSOR] OCR processing page ${pageCount}...`);
        
        const { data: { text } } = await Tesseract.recognize(pageBuffer, 'eng');
        
        combinedText += `--- Page ${pageCount} ---\n${text}\n`;
        pageCount++;
      }
      
      return combinedText;
    })();

    try {
      const result = await Promise.race([ocrPromise, timeoutPromise]);
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }
};

module.exports = PDFProcessor;
