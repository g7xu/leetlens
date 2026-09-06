// postMessage source tags. The MAIN world emits with EVENT_SOURCE and listens
// only for REQUEST_SOURCE; the content script does the reverse. Two tags keep
// the shared window channel loop-free.
export const EVENT_SOURCE = 'leetlens';
export const REQUEST_SOURCE = 'leetlens-req';
