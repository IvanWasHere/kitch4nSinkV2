import Alpine from 'alpinejs'

/*
|--------------------------------------------------------------------------
| Client behaviour
|--------------------------------------------------------------------------
|
| One Alpine component per interaction in the mockup's translation table
| (plan §13.3). The rule these all follow: every interaction must still work
| as a plain form POST with JavaScript disabled. Alpine removes round trips,
| it never *is* the feature — which is why nothing here fetches, routes, or
| renders a list.
|
*/

/**
 * The off-canvas sidebar drawer below 768px. Replaces `state.sidebarOpen`.
 */
Alpine.data('sidebar', () => ({
  open: false,
  toggle() {
    this.open = !this.open
  },
  close() {
    this.open = false
  },
}))

/**
 * Any menu that drops from the header — the account menu, the notification
 * menu. The element is a <details>, so the disclosure itself is the browser's
 * and the menu still opens with JavaScript off; that is what keeps *Sign out*
 * reachable without a bundle (plan §13.3).
 *
 * Alpine adds only the two things <details> does not do on its own: close on
 * a click elsewhere, and close on Escape.
 */
Alpine.data('menu', () => ({
  close() {
    this.$el.open = false
  },
}))

/**
 * Show/hide toggle for a password input. Replaces `state.showPw`.
 */
Alpine.data('passwordField', () => ({
  visible: false,
  toggle() {
    this.visible = !this.visible
  },
  get type() {
    return this.visible ? 'text' : 'password'
  },
  get toggleLabel() {
    return this.visible ? 'Hide' : 'Show'
  },
}))

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong']

/**
 * Password strength on the mockup's five-point scale. This is a hint for the
 * person typing, never a gate — the server owns the password rules.
 */
Alpine.data('passwordStrength', () => ({
  value: '',
  visible: false,
  toggle() {
    this.visible = !this.visible
  },
  get type() {
    return this.visible ? 'text' : 'password'
  },
  get toggleLabel() {
    return this.visible ? 'Hide' : 'Show'
  },
  get score() {
    const password = this.value
    if (!password) {
      return 0
    }

    let score = 0
    if (password.length >= 6) score++
    if (password.length >= 10) score++
    if (/[A-Z]/.test(password)) score++
    if (/[0-9]/.test(password)) score++
    if (/[^A-Za-z0-9]/.test(password)) score++

    return Math.max(score, 1)
  },
  get label() {
    return STRENGTH_LABELS[this.score]
  },
}))

/**
 * Flash message toasts. The message itself is rendered server-side; this only
 * dismisses it (plan §13.3 — there is no client-side showToast()).
 */
Alpine.data('toast', (timeout = 5000) => ({
  visible: false,
  dismissing: false,
  init() {
    setTimeout(() => {
      this.visible = true
    }, 80)

    if (timeout > 0) {
      setTimeout(() => this.dismiss(), timeout)
    }
  },
  dismiss() {
    this.dismissing = true
    setTimeout(() => {
      this.visible = false
    }, 300)
  },
}))

/**
 * A <dialog> modal. The browser supplies focus trapping, Esc-to-close and
 * inertness, so this only owns opening and closing.
 *
 * `$root`, not `$el`: these methods are called from `@click` on the close
 * button and the footer's Cancel, and `$el` is whatever element the
 * expression is being evaluated on — the button, which has no `.close()`.
 * `$root` is the element the component is declared on, which is the <dialog>
 * whichever descendant asked.
 */
Alpine.data('modal', (openOnLoad = false) => ({
  init() {
    if (openOnLoad) {
      this.open()
    }

    /**
     * Clicking the backdrop closes the dialog. The dialog element itself
     * fills its own box, so a click landing on <dialog> is a backdrop click.
     */
    this.$root.addEventListener('click', (event) => {
      if (event.target === this.$root) {
        this.close()
      }
    })
  },
  open() {
    this.$root.showModal()
  },
  close() {
    this.$root.close()
  },
}))

/**
 * Copy a one-time secret — an API key, an invitation link — to the clipboard.
 * The value is always visible next to the button, so a browser that refuses
 * clipboard access still lets the user select it by hand.
 */
Alpine.data('copyToClipboard', (value = '') => ({
  copied: false,
  error: false,
  async copy() {
    try {
      await navigator.clipboard.writeText(value || this.$refs.value?.textContent?.trim() || '')
      this.copied = true
      this.error = false
      setTimeout(() => {
        this.copied = false
      }, 2000)
    } catch {
      this.error = true
    }
  },
}))

/**
 * Textarea that grows with its content — the mockup's reply box.
 */
Alpine.data('autoGrow', (maxHeight = 320) => ({
  init() {
    this.resize()
  },
  resize() {
    const el = this.$el
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  },
}))

/**
 * Drag-and-drop file upload with a progress bar. Falls back to the file input
 * it wraps: with JavaScript off the input and its submit button still work.
 */
Alpine.data('fileUpload', () => ({
  dragging: false,
  files: [],
  progress: 0,
  uploading: false,
  onDragOver() {
    this.dragging = true
  },
  onDragLeave() {
    this.dragging = false
  },
  onDrop(event) {
    this.dragging = false
    const input = this.$refs.input
    if (!input) {
      return
    }

    input.files = event.dataTransfer.files
    this.readFiles(input.files)
    input.dispatchEvent(new Event('change', { bubbles: true }))
  },
  onSelect(event) {
    this.readFiles(event.target.files)
  },
  readFiles(fileList) {
    this.files = Array.from(fileList).map((file) => ({
      name: file.name,
      size: file.size,
    }))
  },
  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  },
  /**
   * Progress is driven by XHR upload events when the form is submitted with
   * JavaScript; the plain POST path never calls this.
   */
  track(request) {
    this.uploading = true
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        this.progress = Math.round((event.loaded / event.total) * 100)
      }
    })
    request.addEventListener('loadend', () => {
      this.uploading = false
    })
  },
}))

/**
 * Avatar / logo picker: swaps the preview to the chosen file before upload.
 */
Alpine.data('imagePreview', (initial = '') => ({
  src: initial,
  onSelect(event) {
    const file = event.target.files?.[0]
    if (file) {
      this.src = URL.createObjectURL(file)
    }
  },
}))

/**
 * Type-to-confirm for destructive actions — deleting an organisation asks for
 * its name (plan §13.6.3).
 */
Alpine.data('confirmByTyping', (expected = '') => ({
  typed: '',
  get matches() {
    return this.typed.trim() === expected
  },
}))

Alpine.start()
