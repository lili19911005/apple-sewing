export const patternTags = ['长裙', '短裙', '长袖', '短袖', '连衣裙', '半身裙', '裤子'] as const
export type PatternTag = typeof patternTags[number]
export type PatternRecord = {
  id: string
  title: string
  size: string
  fileName: string
  cover: string
  coverLarge?: string
  pageCount: number
  fileSize: number
  fingerprint?: string
  tag?: PatternTag | ''
  createdAt: string
}
