/**
 * 轻量媒体 demux：流式抽 AAC 音轨 → ADTS，不做解码/重编码
 */
export { extractAacAdtsFromIsoBmff, shouldTryIsoBmffDemux } from './mp4Extract';
