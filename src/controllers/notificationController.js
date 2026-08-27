import Notification from '../models/Notification.js';
import { publishChange } from '../services/realtimeService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const [items, unreadCount] = await Promise.all([
    Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(limit),
    Notification.countDocuments({ userId: req.user._id, isRead: false })
  ]);

  res.json({ success: true, items, unreadCount });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { isRead: true, readAt: new Date() },
    { returnDocument: 'after' }
  );

  if (!notification) throw new AppError('Notification not found', 404);

  publishChange({
    topics: ['notifications'],
    action: 'NOTIFICATION_READ',
    entityId: notification._id,
    userIds: [req.user._id]
  });

  res.json({ success: true, item: notification });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { userId: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() }
  );

  publishChange({
    topics: ['notifications'],
    action: 'NOTIFICATIONS_READ_ALL',
    userIds: [req.user._id]
  });

  res.json({ success: true });
});
