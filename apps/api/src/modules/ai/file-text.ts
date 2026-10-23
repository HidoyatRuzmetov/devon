import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { extname } from 'node:path'

export type FileText = {
  status: 'read' | 'truncated' | 'unsupported' | 'unavailable'
  text: string
}
const MAX_TEXT = 160_000
const formats = new Set([
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'rtf',
  'html',
  'htm',
  'md',
  'txt',
  'csv',
  'tsv',
  'json',
  'xml',
  'log',
])
const modulePath = createRequire(import.meta.url).resolve('officeparser')
let activeWorkers = 0
// Static worker code: file bytes are data, never interpolated into executable source. OCR and
// embedded files are disabled; ZIP expansion, heap size, input size and wall time are bounded.
const workerCode = `
const {parentPort,workerData}=require('node:worker_threads');
const {parseOffice}=require(workerData.modulePath);
(async()=>{
  const input=Buffer.from(workerData.bytes);
  let text;
  let partial=false;
  if(['txt','csv','tsv','json','xml','log','md'].includes(workerData.format)) text=input.toString('utf8');
  else {
    const ast=await parseOffice(input,{fileType:workerData.format,ocr:false,extractAttachments:false,
      includeRawContent:false,decompressionLimits:{maxUncompressedBytes:32*1024*1024,maxZipEntries:2000,
      maxTableCells:50000,maxXmlElements:100000,maxRawContentLength:0,maxRepeatedContent:1000000}});
    text=(await ast.to('text')).value;
    partial=Boolean(ast.warnings?.length);
  }
  text=String(text).replace(/\\u0000/g,'').trim();
  parentPort.postMessage({status:!text?'unavailable':partial||text.length>workerData.maxText?'truncated':'read',text:text.slice(0,workerData.maxText)});
})().catch(()=>parentPort.postMessage({status:'unavailable',text:''}));
`

export async function extractFileText(
  bytes: Buffer,
  name: string,
  timeoutMs = 20_000,
): Promise<FileText> {
  const format = extname(name).slice(1).toLowerCase()
  if (!formats.has(format)) return { status: 'unsupported', text: '' }
  if (bytes.byteLength > 20 * 1024 * 1024) return { status: 'unavailable', text: '' }
  // A burst of chats cannot create unbounded parser heaps. Busy work remains retryable.
  if (activeWorkers >= 2) return { status: 'unavailable', text: '' }
  activeWorkers++
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(workerCode, {
        eval: true,
        workerData: {
          modulePath,
          bytes,
          format: format === 'htm' ? 'html' : format,
          maxText: MAX_TEXT,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 192,
          maxYoungGenerationSizeMb: 32,
        },
      })
    } catch {
      activeWorkers--
      resolve({ status: 'unavailable', text: '' })
      return
    }
    let settled = false
    const done = (result: FileText) => {
      if (settled) return
      settled = true
      activeWorkers--
      clearTimeout(timer)
      void worker.terminate()
      resolve(result)
    }
    const timer = setTimeout(() => done({ status: 'unavailable', text: '' }), timeoutMs)
    worker.once('message', (value: FileText) => done(value))
    worker.once('error', () => done({ status: 'unavailable', text: '' }))
    worker.once('exit', () => done({ status: 'unavailable', text: '' }))
  })
}
