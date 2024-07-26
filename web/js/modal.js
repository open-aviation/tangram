function Modal(options) {
  options = Object.assign({
    title: 'Title',
    backgroundColor: '#fff',
    mask: true,
    content: 'Content',
    cancelText: 'Cancel',
    okText: 'Ok',
    width: 400,
    onCancel: this.closeModal,
    onOk: () => {
      console.log('ok')
    }, // confirm btn
  }, options)
  this.options = options

  // mask
  function createMask() {
    let mask = document.createElement('div')
    mask.className = 'mask'
    document.body.appendChild(mask)
  }

  // create modal
  function createModal() {
    let modal = document.createElement('div'),
      titleDom = document.createElement('div'),
      main = document.createElement('div'),
      footer = document.createElement('div'),
      btn_l = document.createElement('button'),
      btn_r = document.createElement('button');

    let { title, content, cancelText, okText, width, onCancel, onOk, backgroundColor
    } = this.options
    modal.className = 'modal_content'
    modal.style.width = width + 'px'
    modal.style.backgroundColor = backgroundColor

    titleDom.className = 'title'
    let closeIcon = document.createElement('span')
    closeIcon.addEventListener('click', closeModal.bind(this))
    closeIcon.className = 'close'
    closeIcon.innerHTML = 'x'
    titleDom.innerHTML = `<span>${title}</span>`
    titleDom.appendChild(closeIcon)

    main.className = 'main'
    main.innerHTML = content

    footer.className = 'footer'
    btn_l.innerHTML = 'Cancel'
    btn_r.innerHTML = 'Ok'
    footer.appendChild(btn_l)
    footer.appendChild(btn_r)

    onCancel = onCancel ? onCancel : this.closeModal
    btn_l.addEventListener('click', onCancel.bind(this))
    btn_r.addEventListener('click', onOk)

    modal.appendChild(titleDom)
    modal.appendChild(main)
    modal.appendChild(footer)

    document.body.appendChild(modal)
  }

  function closeModal(ev) {
    document.querySelector('.mask') ? document.body.removeChild(document.querySelector('.mask')) : null
    if(document.querySelector('.modal_content')) document.body.removeChild(document.querySelector('.modal_content'))
  }

  function init() {
    let { mask } = this.options
    mask ? createMask() : null
    this.createModal()
  }

  Modal.prototype.init = init
  Modal.prototype.createModal = createModal
  Modal.prototype.closeModal = closeModal

  this.init()
}
