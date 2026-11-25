export { FORMAT_LABELS, metricLabel } from './constants';
export const MEDIA_METRICS_UI: Record<'REELS' | 'FEED' | 'STORY', string[]> = {
  REELS: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'reposts', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'],
  FEED: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'reposts', 'profile_visits', 'follows'],
  STORY: ['views', 'reach', 'replies', 'shares', 'total_interactions', 'follows', 'profile_visits'],
};
