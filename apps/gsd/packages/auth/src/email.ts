type EmailModule = typeof import("@kan/email");
type SendEmail = EmailModule["sendEmail"];
type NotificationClient = EmailModule["notificationClient"];

export const sendAuthEmail: SendEmail = async (...args) => {
  const { sendEmail } = await import("@kan/email");
  return sendEmail(...args);
};

export const getNotificationClient = async (): Promise<NotificationClient> => {
  const { notificationClient } = await import("@kan/email");
  return notificationClient;
};
