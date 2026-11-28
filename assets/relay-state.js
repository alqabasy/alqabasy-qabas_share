// Shared presentation policy; transport and backend enums stay at the API boundary.
export const activeRows = rows => rows.filter(row => row.state !== 'removed');
export function limits(field) {
  return {count: field.constraints?.maxFiles ?? 5, bytes: 20 * 1024 * 1024,
    types: field.constraints?.allowedMediaTypes ?? ['application/pdf', 'image/jpeg', 'image/png']};
}
export function fileError(field, file, rows) {
  const policy = limits(field);
  if (activeRows(rows).some(row => row.file.name === file.name && row.file.size === file.size && row.file.lastModified === file.lastModified)) return 'هذا الملف مضاف بالفعل.';
  if (activeRows(rows).length >= policy.count) return 'تمت إضافة الحد الأقصى من المرفقات.';
  if (!policy.types.includes(file.type)) return 'نوع الملف غير مدعوم.';
  if (file.size > policy.bytes) return 'حجم الملف أكبر من المسموح (٢٠ ميغابايت).';
  if (!file.size) return 'الملف فارغ. اختر ملفًا آخر.';
  if (file.name.length > 200) return 'اسم الملف طويل جدًا. اختصر الاسم ثم اختره مجددًا.';
  return '';
}
export function userError(error) {
  // This API uses a shared conflict code; match the known message narrowly.
  if (error.code === 'conflict' && error.message?.trim() === 'Evidence field file limit reached.') {
    return 'تمت إضافة الحد الأقصى من المرفقات.';
  }
  if (error.code === 'timeout') return 'استغرقت العملية وقتًا طويلًا. تحقق من اتصالك.';
  return ({0:'انقطع الاتصال بالإنترنت.',400:'لم نتمكن من قبول هذا الملف.',401:'الرابط غير متاح. تواصل مع المرسل.',403:'الرابط غير متاح. تواصل مع المرسل.',404:'الرابط أو المرفق غير متاح.',409:'تعذّر قبول العملية. ربما تغيّرت حالة الطلب.',410:'انتهت صلاحية هذا الرابط.',413:'حجم الملف أكبر من المسموح.',415:'نوع الملف غير مدعوم.',422:'لم نتمكن من قبول هذا الملف.',429:'انتظر قليلًا ثم حاول مجددًا.'})[error.status] || 'الخدمة غير متاحة مؤقتًا.';
}
export const recoverable = error => !error.status || error.status === 429 || error.status >= 500;
export function attachmentProblem(rows) {
  const live = activeRows(rows);
  if (live.some(r => ['selected','uploading'].includes(r.state))) return 'انتظر اكتمال رفع المرفقات.';
  if (live.some(r => ['failed','rejected'].includes(r.state))) return 'راجع المرفقات المتعذّرة أو أزلها قبل الإرسال.';
  // The public contract accepts processing evidence and returns EVIDENCE_PENDING.
  return '';
}
