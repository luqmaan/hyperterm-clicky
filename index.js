/* global store, config */
const { shell } = require('electron')
const escapeHTML = require('escape-html')
const emailRegex = require('email-regex')
const urlRegex = require('./url-regex')
const exec = require('child_process').exec

const emailRe = emailRegex({ exact: true })
const stackTraceRe = /\((\/.*:\d*:\d*)\)/g

exports.getTermProps = function (uid, parentProps, props) {
  return Object.assign(props, {uid})
}

exports.decorateTerm = function (Term, { React }) {
  return class extends React.Component {
    constructor (props, context) {
      super(props, context)

      this.onTerminal = this.onTerminal.bind(this)
      this.term = null
      this.id = 0
    }

    onTerminal (term) {
      if (this.props.onTerminal) {
        this.props.onTerminal(term)
      }

      this.term = term
      const { screen_, onTerminalReady } = term

      this.overrideScreen(screen_.constructor)

      const self = this
      term.onTerminalReady = function () {
        onTerminalReady.apply(this, arguments)

        const screenNode = term.scrollPort_.getScreenNode()
        screenNode.addEventListener('click', self.onLinkClick.bind(self))
        screenNode.addEventListener('mouseover', self.onLinkMouseOver.bind(self))
        screenNode.addEventListener('mouseout', self.onLinkMouseOut.bind(self))
      }
    }

    overrideScreen (Screen) {
      if (Screen._links) return
      Screen._links = true

      const self = this

      const { insertString, deleteChars } = Screen.prototype

      Screen.prototype.insertString = function () {
        const result = insertString.apply(this, arguments)
        self.autolink(this)
        return result
      }

      Screen.prototype.deleteChars = function () {
        const result = deleteChars.apply(this, arguments)
        self.autolink(this)
        return result
      }
    }

    autolink (screen) {
      if (screen.cursorNode_.nodeName === '#text') {
        // replace text node to element
        const cursorNode = document.createElement('span')
        cursorNode.textContent = screen.cursorNode_.textContent
        screen.cursorRowNode_.replaceChild(cursorNode, screen.cursorNode_)
        screen.cursorNode_ = cursorNode
      }

      const rows = []
      let lastRow = screen.cursorRowNode_

      while (true) {
        rows.unshift(lastRow)
        if (lastRow.children.length > 1) break
        lastRow = lastRow.previousSibling
        if (!lastRow || !lastRow.getAttribute('line-overflow')) break
      }

      const textContent = rows.map((r) => r.lastChild.textContent).join('')
      const re = urlRegex()
      const urls = []
      let match

      while (match = re.exec(textContent)) { // eslint-disable-line
        const text = match[0]
        const url = this.getAbsoluteUrl(text)
        const start = re.lastIndex - text.length
        const end = re.lastIndex
        const id = this.id++
        urls.push({id, url, start, end})
      }

      if (!urls.length) {
        match = stackTraceRe.exec(textContent)
        if (match) {
          const url = match[1]
          const start = textContent.indexOf('/')
          const end = textContent.indexOf(')')
          const id = this.id++
          urls.push({id, url, start, end, fileName: url})
        }
      }
      if (!urls.length) return

      let rowStart = 0
      let rowEnd = 0
      let urlIndex = 0

      const htmls = rows.map((row, i) => {
        rowStart = rowEnd
        rowEnd += row.lastChild.textContent.length
        let textStart = rowStart

        let html = ''

        while (urls[urlIndex]) {
          const { id, url, start, end, fileName } = urls[urlIndex]

          if (start > textStart) {
            const textEnd = start < rowEnd ? start : rowEnd
            html += escapeHTML(textContent.slice(textStart, textEnd))
          }

          if (start < rowEnd) {
            const urlStart = start > rowStart ? start : rowStart
            const urlEnd = end < rowEnd ? end : rowEnd
            let anchor
            if (fileName) {
              anchor = `<a href="${escapeHTML(url)}" data-id="${id}" data-file-name="${fileName}">`
            }
            anchor = `<a href="${escapeHTML(url)}" data-id="${id}">`
            html += anchor
            html += escapeHTML(textContent.slice(urlStart, urlEnd))
            html += '</a>'
          }

          if (end > rowEnd) break

          textStart = end
          urlIndex++
        }

        if (!urls[urlIndex]) {
          html += escapeHTML(textContent.slice(textStart, rowEnd))
        }

        return html
      })

      for (let i = 0, l = rows.length; i < l; i++) {
        rows[i].lastChild.innerHTML = htmls[i]
      }
    }

    getAbsoluteUrl (url) {
      if (/^[a-z]+:\/\//.test(url)) return url
      if (url.indexOf('//') === 0) return `http${url}`
      if (emailRe.test(url)) return `mailto:${url}`
      return `http://${url}`
    }

    onLinkClick (e) {
      if (e.target.nodeName !== 'A') return

      e.preventDefault()
      const fileName = e.target.getAttribute('data-file-name')
      if (fileName) {
        let editor
        try {
          editor = config.getConfig().clicky.editor
        } catch (err) {
          editor = 'atom'
        }
        return exec(editor + ' ' + fileName)
      }
      if (e.metaKey || e.altKey) { // metaKey has other uses on Ubuntu which conflict with the action, so altKey is an alternative
        store.dispatch({
          type: 'SESSION_URL_SET',
          uid: this.props.uid,
          url: e.target.href
        })
      } else {
        // open in user's default browser by default
        shell.openExternal(e.target.href)
      }
    }

    onLinkMouseOver (e) {
      if (e.target.nodeName !== 'A') return

      const { id } = e.target.dataset
      for (const a of this.getAnchors(id)) {
        a.classList.add('hover')
      }
    }

    onLinkMouseOut (e) {
      if (e.target.nodeName !== 'A') return

      const { id } = e.target.dataset
      for (const a of this.getAnchors(id)) {
        a.classList.remove('hover')
      }
    }

    getAnchors (id) {
      const screenNode = this.term.scrollPort_.getScreenNode()
      return screenNode.querySelectorAll(`a[data-id="${id}"]`)
    }

    render () {
      const props = Object.assign({}, this.props, {
        onTerminal: this.onTerminal,
        customCSS: styles + (this.props.customCSS || '')
      })
      return React.createElement(Term, props)
    }
  }
}

const styles = `
  x-screen a {
    color: #ff2e88;
    text-decoration: none;
  }

  x-screen a.hover {
    text-decoration: underline;
  }
`
