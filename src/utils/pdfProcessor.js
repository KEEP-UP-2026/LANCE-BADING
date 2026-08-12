// Keep Up System - PaddleOCR PDF Processor Utility
// Uses PaddleOCR (via Python subprocess) for accurate text extraction and layout preservation.
// Falls back to pdf-parse for digital-native text PDFs to skip unnecessary OCR.
// For scanned/image PDFs, converts pages then runs PaddleOCR page-by-page.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Path to the Python OCR service script
const OCR_SCRIPT = path.join(process.cwd(), 'ocr_service.py');

/**
 * Run PaddleOCR on a single image/PDF file via Python subprocess.
 * Returns structured OCR result: { text, layout_blocks, page_size, success }
 */
function runPaddleOCR(filePath, pageNumber = 1) {
  return new Promise((resolve, reject) => {
    const args = [OCR_SCRIPT, filePath, '--page', String(pageNumber)];
    // NOTE: Do NOT use spawn's built-in timeout option — it kills the process with
    // SIGTERM which causes close to emit with code=null even when JSON was already
    // written to stdout. The controller's Promise.race() handles overall timeouts.
    const py = spawn('python', args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    py.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    py.on('close', (code) => {
      const trimmedStdout = stdout.trim();

      // Find the last line that looks like a JSON object
      const jsonLine = trimmedStdout
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('{'))
        .pop();

      if (jsonLine) {
        try {
          const result = JSON.parse(jsonLine);
          if (result.success) {
            return resolve(result);
          } else if (result.error) {
            return reject(new Error(result.error));
          }
        } catch (parseErr) {
          console.error('[OCR] Failed to parse JSON output:', parseErr.message);
        }
      }

      // code === null means the process was killed (SIGTERM/SIGKILL by timeout)
      if (code === null) {
        return reject(new Error(`OCR process was killed (timeout or signal). Stderr: ${stderr.slice(0, 300)}`));
      }

      if (code !== 0) {
        return reject(new Error(`OCR process exited with code ${code}: ${stderr.slice(0, 500)}`));
      }

      reject(new Error('OCR process returned no valid JSON output.'));
    });

    py.on('error', (err) => {
      reject(new Error(`Failed to start OCR process: ${err.message}. Ensure Python is installed and ocr_service.py exists.`));
    });
  });
}


const PDFProcessor = {

  /**
   * Extract text (and layout blocks) from a PDF or image file.
   * Returns: { text: string, layout_blocks: Array, page_size: [w,h] }
   */
  async extractTextFromPdf(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found on disk.');
    }

    const fileExt = path.extname(filePath).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(fileExt);

    // For image files, run PaddleOCR directly
    if (isImage) {
      console.log(`[OCR] Running PaddleOCR on image: ${path.basename(filePath)}`);
      return await runPaddleOCR(filePath, 1);
    }

    // For PDFs: first try digital-native text extraction
    const dataBuffer = fs.readFileSync(filePath);

    const isEncrypted = dataBuffer.toString('binary', 0, Math.min(dataBuffer.length, 10240)).includes('/Encrypt');
    if (isEncrypted) {
      throw new Error('Encrypted PDF documents are not supported for safety.');
    }

    let digitalText = '';
    let isDigitalTextValid = false;

    try {
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(dataBuffer);
      digitalText = parsed.text || '';
      const minLen = parseInt(process.env.OCR_MIN_TEXT_LENGTH || '30', 10);
      if (digitalText.trim().length >= minLen) {
        isDigitalTextValid = true;
      }
    } catch (err) {
      console.warn('[OCR] pdf-parse failed, using PaddleOCR fallback:', err.message);
    }

    if (isDigitalTextValid) {
      console.log(`[OCR] Digital-native PDF detected. Using pdf-parse extraction.`);
      return {
        text: digitalText,
        layout_blocks: [],
        page_size: [595, 842],  // A4 default
        success: true
      };
    }

    // For scanned PDFs: run PaddleOCR page-by-page
    console.log(`[OCR] Scanned/image PDF detected. Running PaddleOCR page-by-page...`);

    const maxPages = parseInt(process.env.MAX_PDF_PAGES || '10', 10);
    const timeoutSec = parseInt(process.env.OCR_PROCESS_TIMEOUT_SECONDS || '120', 10);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`PDF OCR processing timed out after ${timeoutSec} seconds.`));
      }, timeoutSec * 1000);
    });

    const ocrPromise = (async () => {
      let combinedText = '';
      let allLayoutBlocks = [];
      let pageSize = [595, 842];

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        try {
          console.log(`[OCR] PaddleOCR processing PDF page ${pageNum}...`);
          const pageResult = await runPaddleOCR(filePath, pageNum);

          if (!pageResult.text && pageNum > 1) break; // No more pages

          combinedText += (combinedText ? '\n\n--- Page ' + pageNum + ' ---\n' : '') + pageResult.text;

          // Annotate blocks with page number
          const pageBlocks = (pageResult.layout_blocks || []).map(b => ({ ...b, page: pageNum }));
          allLayoutBlocks = allLayoutBlocks.concat(pageBlocks);

          if (pageNum === 1) pageSize = pageResult.page_size || pageSize;
        } catch (pageErr) {
          if (pageNum === 1) throw pageErr; // First page is critical
          console.warn(`[OCR] Page ${pageNum} failed, stopping: ${pageErr.message}`);
          break;
        }
      }

      return {
        success: true,
        text: combinedText,
        layout_blocks: allLayoutBlocks,
        page_size: pageSize
      };
    })();

    return await Promise.race([ocrPromise, timeoutPromise]);
  },

  /**
   * Extract text only (string) — used by classifier and search indexing.
   */
  async extractText(filePath) {
    const result = await this.extractTextFromPdf(filePath);
    return result.text || '';
  }
};

module.exports = PDFProcessor;
