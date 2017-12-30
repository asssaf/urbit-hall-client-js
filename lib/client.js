'use strict';

const urbit = require('@asssaf/urbit')
const debug = require('debug')("urbit-hall-client:debug")

const HALL_APP = "hall"
const HALL_ACTION_MARK = "hall-action"
const INBOX_CIRCLE = "inbox"
const DEFAULT_PATH = "/circle/" + INBOX_CIRCLE + "/grams/"
const SEND_PATH = "/"

async function subscribe(session, wire, callback, from, to) {
  var path = DEFAULT_PATH
  if (!from) {
    // start from 6 hours ago
    var startDate = new Date(new Date().getTime() - 1000*60*60*6)
    path += formatDate(new Date(startDate))

  } else {
    path += from
    if (to) {
      path += "/" + to
    }
  }

  var decoratedCallback = function(wire, data) {
    debug("messages", wire, data)

    if (data == null) {
      // got %quit
      debug("got %quit for: " + wire)

      //TODO resubscribe?
      callback(wire, data)
      return
    }

    var messages = []
    if (data.circle && (data.circle.nes || data.circle.gram)) {
      var grams
      if (data.circle.nes) {
        grams = data.circle.nes

      } else {
        grams = [data.circle.gram]
      }

      grams.forEach(t => {
        messages.push(...processSpeech(t, t.gam.sep))
      })
    }

    callback(wire, messages)
  }

  return await urbit.webapi.subscribe(session, session.ship, wire, HALL_APP, path, decoratedCallback)
}

async function unsubscribe(session, wire) {
  return await urbit.webapi.unsubscribe(session, session.ship, wire, HALL_APP)
}

/**
 * format a number the urbit way (1.024)
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * format a date the urbit way (~2017.12.27..18.48.00..0000)
 */
function formatDate(dat) {
  var mils = Math.floor((0x10000 * dat.getUTCMilliseconds()) / 1000).toString(16)
  function pad(num, str){
    return ((new Array(num + 1)).join('0') + str).substr(-num,num)
  }
  return  '~' + dat.getUTCFullYear() +
          '.' + (dat.getUTCMonth() + 1) +
          '.' + dat.getUTCDate() +
         '..' + pad(2, dat.getUTCHours()) +
          '.' + pad(2, dat.getUTCMinutes()) +
          '.' + pad(2, dat.getUTCSeconds()) +
         '..' + pad(4, mils)
}

function getInboxStation(ship) {
  return "~" + ship + "/" + INBOX_CIRCLE
}

function processSpeech(m, speech, serial) {
  var type = Object.keys(speech)[0]

  var message = {
    key: serial || m.gam.uid,
    date: m.gam.wen,
    sender: m.gam.aut,
    audience: m.gam.aud,
    style: "message",
    type: type,
    num: m.num,
  }

  var messages = [message]

  if (type == 'lin') {
    message["text"] = speech[type].msg

    if (speech.lin.pat) {
      message["style"] = "messageAct"
    }

  } else if (type == 'url') {
    message["text"] = speech.url
    message["style"] = "messageUrl"

  } else if (type == 'exp') {
    message["text"] = speech.exp.exp
    message["attachment"] = speech.exp.res.map(r => r.join('\n')).join('\n')
    message["style"] = "messageCode"


  } else if (type == 'app') {
    messages = processSpeech(m, speech.app.sep, serial + 1)
    message = messages[0]
    message["text"] = "[" + speech.app.app + "]: " + message["text"]

  } else if (type == 'fat') {
    messages = processSpeech(m, speech.fat.sep, serial + 1)
    message["text"] = messages[0]["text"]
    messages[0] = message

    if (speech.fat.tac.text) {
      message["attachment"] = speech.fat.tac.text

    } else if (speech.fat.tac.tank) {
      message["attachment"] = speech.fat.tac.tank.join('\n')

    } else if (speech.fat.tac.name) {
      //TODO add name label
      message["attachment"] = speech.fat.tac.name.tac.text
    }

  } else if (type == 'ire') {
    //TODO link to origin message speech.ire.top
    messages = processSpeech(m, speech.ire.sep, serial)
    message = messages[0]

  } else {
    debug("Unhandled speech: %" + type, speech)
    message["text"] = 'Unhandled speech: %' + type
  }

  if (!message["text"]) {
    message["text"] = ' '
  }

  return messages
}

async function sendMessage(session, text, audience) {
  if (!audience) {
    // send a private message to self
    audience = ["~" + session.ship + "/" + INBOX_CIRCLE]
  }
  var speeches = []
  if (isUrl(text)) {
    speeches.push(buildSpeech("url", text))

  } else if (text.charAt(0) == '#') {
    speeches.push(buildSpeech("exp", text.substring(1)))

  } else {
    var pat = false
    if (text.charAt(0) == '@') {
      text = text.substring(1)
      pat = true
    }

    if (text.length > 0) {
      speeches.push(buildSpeech('lin', text, pat))
    }
  }

  var payload = {
    phrase: {
      aud: audience,
      ses: speeches,
    }
  }

  var res = await urbit.webapi.poke(session, HALL_APP, HALL_ACTION_MARK, SEND_PATH, payload)
  if (!res) {
    debug('Send Error - An error occured while sending the message', payload)
    return false
  }

  return true
}

function buildSpeech(type, text, arg) {
  var speech
  if (type == "lin") {
    speech = {
      msg: text,
      pat: arg
    }

  } else if (type == "exp") {
    speech = {
      exp: text
    }

  } else {
    speech = text
  }

  return {
    [type]: speech
  }
}

function isUrl(s) {
  var pattern = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/
  var re = new RegExp(pattern)
  return s.match(re)
}

function enableLogging() {
  debug.enable('urbit-hall-client:*')
}

module.exports = {
  subscribe,
  unsubscribe,
  sendMessage,
  formatNumber,
  formatDate,
  getInboxStation,
  enableLogging,
}
