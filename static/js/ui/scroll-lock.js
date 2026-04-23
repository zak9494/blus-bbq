/* ===== MODULE: scroll-lock
   Prevents body scroll while a bottom-sheet or modal is open.
   Preserves scroll position on unlock (critical for iOS fixed-position trick).
   API: window.scrollLock.lock() / window.scrollLock.unlock()
   ===== */
(function () {
  let count = 0;
  let savedY = 0;

  function lock() {
    if (count === 0) {
      savedY = window.scrollY;
      document.body.style.overflow  = 'hidden';
      document.body.style.position  = 'fixed';
      document.body.style.top       = '-' + savedY + 'px';
      document.body.style.left      = '0';
      document.body.style.right     = '0';
    }
    count++;
  }

  function unlock() {
    if (count <= 0) return;
    count--;
    if (count === 0) {
      document.body.style.overflow  = '';
      document.body.style.position  = '';
      document.body.style.top       = '';
      document.body.style.left      = '';
      document.body.style.right     = '';
      window.scrollTo(0, savedY);
    }
  }

  window.scrollLock = { lock, unlock };
}());
