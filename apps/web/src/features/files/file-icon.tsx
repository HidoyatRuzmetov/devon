import {
  FileText,
  FileSpreadsheet,
  FileArchive,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  File,
} from 'lucide-react'
import { fileKind } from './file-types.js'

export function AttachmentIcon({ name, className }: { name: string; className?: string }) {
  const kind = fileKind(name)
  const Icon =
    kind === 'pdf' || kind === 'word'
      ? FileText
      : kind === 'sheet'
        ? FileSpreadsheet
        : kind === 'archive'
          ? FileArchive
          : kind === 'image'
            ? FileImage
            : kind === 'audio'
              ? FileAudio
              : kind === 'video'
                ? FileVideo
                : kind === 'html' || kind === 'text'
                  ? FileCode
                  : File
  return <Icon className={className} aria-hidden="true" />
}
