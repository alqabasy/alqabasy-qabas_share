// Shared presentation policy; transport and backend enums stay at the API boundary.
export const activeRows = rows => rows.filter(row => row.state !== 'removed');
export function limits(field) {
  return {count: field.constraints?.maxFiles ?? 20, bytes: 50 * 1024 * 1024,
    types: field.constraints?.allowedMediaTypes ?? ['application/pdf', 'image/jpeg', 'image/png']};
}
export function fileError(field, file, rows) {
  const policy = limits(field);
  if (activeRows(rows).some(row => row.file.name === file.name && row.file.size === file.size && row.file.lastModified === file.lastModified)) return 'هذا الملف مضاف بالفعل.';
  if (activeRows(rows).length >= policy.count) return 'تمت إضافة الحد الأقصى من المرفقات.';
  if (!policy.types.includes(file.type)) return 'نوع الملف غير مدعوم.';
  if (file.size > policy.bytes) return 'حجم الملف أكبر من المسموح (٥٠ ميغابايت).';
  if (!file.size) return 'الملف فارغ. اختر ملفًا آخر.';
  if (file.name.length > 200) return 'اسم الملف طويل جدًا. اختصر الاسم ثم اختره مجددًا.';
  return '';
}
export function userError(error) {
  const number=value=>Number.isSafeInteger(value)&&value>0?new Intl.NumberFormat('ar-EG').format(value):null;
  const maxFiles=number(error.params?.maxFiles),maxBytes=number(error.params?.maxBytes);
  if(error.code==='evidence.file_limit_reached')return maxFiles?`وصلت المرفقات إلى الحد المسموح (${maxFiles} ملفًا). أزل مرفقًا لم ترسله أو تواصل مع المرسل.`:'تمت إضافة الحد الأقصى من المرفقات.';
  if(error.code==='evidence.file_too_large')return maxBytes?`حجم الملف أكبر من المسموح (${maxBytes} بايت).`:'حجم الملف أكبر من المسموح.';
  const evidenceMessages={
    'evidence.field_not_found':'حقل المرفقات غير متاح. تواصل مع المرسل.',
    'evidence.file_type_not_allowed':'نوع الملف غير مدعوم.',
    'evidence.upload_metadata_invalid':'تحقق من اسم الملف ونوعه وحجمه ثم اختره مجددًا.',
    'evidence.upload_session_unavailable':'انتهت مهلة رفع المرفق. أزله واختره مجددًا.',
    'evidence.content_mismatch':'تعذّر قراءة الملف كما تم اختياره. أزله واختر الملف الأصلي مجددًا.',
    'evidence.upload_in_progress':'جارٍ تجهيز هذا المرفق. انتظر قليلًا ثم تحقق مجددًا.',
    'evidence.not_found':'هذا المرفق غير متاح.',
    'evidence.not_owned':'لا يمكن استخدام هذا المرفق في الطلب الحالي.',
    'evidence.retry_unavailable':'لا يمكن إعادة تجهيز هذا المرفق. تواصل مع المرسل.',
    'evidence.abandon_unavailable':'تم إرسال هذا المرفق بالفعل ولا يمكن إزالته.'
  };
  if(evidenceMessages[error.code])return evidenceMessages[error.code];
  if (error.code === 'timeout') return 'استغرقت العملية وقتًا طويلًا. تحقق من اتصالك.';
  return ({0:'انقطع الاتصال بالإنترنت.',400:'لم نتمكن من قبول هذا الملف.',401:'الرابط غير متاح. تواصل مع المرسل.',403:'الرابط غير متاح. تواصل مع المرسل.',404:'الرابط أو المرفق غير متاح.',409:'تعذّر قبول العملية. ربما تغيّرت حالة الطلب.',410:'انتهت صلاحية هذا الرابط.',413:'حجم الملف أكبر من المسموح.',415:'نوع الملف غير مدعوم.',422:'لم نتمكن من قبول هذا الملف.',429:'انتظر قليلًا ثم حاول مجددًا.'})[error.status] || 'الخدمة غير متاحة مؤقتًا.';
}
export const recoverable = error => !error.status || error.status === 429 || error.status >= 500;
export function attachmentProblem(rows) {
  const live = activeRows(rows);
  if (live.some(r => ['selected','uploading','removing'].includes(r.state))) return 'انتظر اكتمال رفع المرفقات.';
  if (live.some(r => ['failed','rejected'].includes(r.state))) return 'راجع المرفقات المتعذّرة أو أزلها قبل الإرسال.';
  // The public contract accepts processing evidence and returns EVIDENCE_PENDING.
  return '';
}

// Status actions are authoritative; a scan retry is not a public API operation.
export function evidencePresentation(result) {
  if(result.status==='READY')return {state:'ready',retryable:false,error:''};
  if(result.action==='WAIT_OR_CONTACT_SUPPORT'&&result.retryable===true)return {state:'failed',retryable:true,error:'تعذّر تجهيز المرفق مؤقتًا. تحقق مجددًا لاحقًا أو تواصل مع المرسل.'};
  if(result.action==='UPLOAD_BYTES')return {state:'failed',retryable:false,error:'لم يكتمل رفع المرفق. أزله واختره مجددًا.'};
  if(result.action==='START_NEW_UPLOAD'||['REJECTED','FAILED'].includes(result.status))return {state:'rejected',retryable:false,error:result.failureCode==='UPLOAD_EXPIRED'?'انتهت مهلة رفع المرفق. أزله واختره مجددًا.':'لم نتمكن من قبول هذا الملف. أزله واختر ملفًا آخر.'};
  if(result.action==='WAIT_FOR_SCAN'||result.status==='PROCESSING')return {state:'processing',retryable:false,error:''};
  return {state:'failed',retryable:true,error:'تعذّر التأكد من حالة المرفق. تحقق مجددًا.'};
}
