// 仅供本地测试：一个极简的假 IMAP 服务器（明文、不加密），照 Gmail 的回包格式说话。
// 账号 souki@ala.jp／应用密码 abcdabcdabcdabcd 能登录；收件箱里有两封没读的（其中一封是多段＋base64 中文正文）。
import net from 'node:net';

const MSGS = [
  { uid: 101, msgid: '1812345678901234567', thrid: '1812345678901234567', date: '20-Oct-2026 09:15:00 +0900',
    head: 'From: =?UTF-8?B?6buE5b+X6b6Z?= <huang@example.com>\r\nSubject: =?UTF-8?B?55u06L+e5rWL6K+V?=\r\nDate: Mon, 20 Oct 2026 09:15:00 +0900\r\nContent-Type: multipart/alternative; boundary="b1"\r\n',
    body: '--b1\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + Buffer.from('源码交接的事，下周可以。', 'utf8').toString('base64') + '\r\n--b1\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n<p>x</p>\r\n--b1--\r\n' },
  { uid: 102, msgid: '1812345678901234999', thrid: '1812345678901234999', date: '21-Oct-2026 08:00:00 +0900',
    head: 'From: no-reply@research.anthropic.com\r\nSubject: We\'d love your thoughts on Claude\r\nDate: Tue, 21 Oct 2026 08:00:00 +0900\r\nContent-Type: text/plain; charset="us-ascii"\r\nContent-Transfer-Encoding: quoted-printable\r\n',
    body: 'Your feedback will help us make Claude better=0D=0AWe=27d love your thoughts\r\n' },
  { uid: 103, msgid: '1812345678901235555', thrid: '1812345678901235555', date: '20-Oct-2026 18:00:00 +0900',   /* 正文＋附件：mixed 里套 alternative（Gmail 默认结构） */
    head: `From: =?UTF-8?B?${Buffer.from('姚总').toString('base64')}?= <yao@example.com>\r\nSubject: =?UTF-8?B?${Buffer.from('合同附件').toString('base64')}?=\r\nDate: Mon, 20 Oct 2026 18:00:00 +0900\r\nContent-Type: multipart/mixed; boundary="out"\r\n`,
    body: '--out\r\nContent-Type: multipart/alternative; boundary="in"\r\n\r\n--in\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + Buffer.from('合同已签回，附件是扫描件。', 'utf8').toString('base64') + '\r\n--in\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n<p>x</p>\r\n--in--\r\n--out\r\nContent-Type: application/pdf; name="contract.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0x\r\n--out--\r\n' },
];
const lit = s => `{${Buffer.byteLength(s, 'latin1')}}\r\n${s}`;

export function startImap() {
  const calls = [];
  const srv = net.createServer(sock => {
    sock.write('* OK Gimap ready for requests\r\n');
    let buf = '';
    sock.on('data', d => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const m = /^(\S+) (\S+)(?: (.*))?$/.exec(line); if (!m) continue;
        const [, tag, cmd, rest = ''] = m; calls.push(cmd + ' ' + rest);
        const C = cmd.toUpperCase();
        if (C === 'LOGIN') {
          if (/"dropdropdropdrop"/.test(rest)) { sock.end(`${tag} OK souki@ala.jp authenticated (Success)\r\n`); }   /* 登录成功后对方掐线（测断线处理） */
          else sock.write(/"souki@ala\.jp" "abcdabcdabcdabcd"/.test(rest) ? `${tag} OK souki@ala.jp authenticated (Success)\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
        }
        else if (C === 'SELECT') sock.write(`* ${MSGS.length} EXISTS\r\n* 0 RECENT\r\n* FLAGS (\\Seen)\r\n${tag} OK [READ-WRITE] INBOX selected. (Success)\r\n`);
        else if (C === 'UID' && /^SEARCH/i.test(rest)) sock.write(`* SEARCH ${MSGS.map(x => x.uid).join(' ')}\r\n${tag} OK SEARCH completed (Success)\r\n`);
        else if (C === 'UID' && /^FETCH/i.test(rest)) {
          const want = (/^FETCH ([\d,:]+)/i.exec(rest) || [, ''])[1].split(',').map(Number);
          MSGS.filter(x => want.includes(x.uid)).forEach((x, k) => sock.write(`* ${k + 1} FETCH (UID ${x.uid} X-GM-MSGID ${x.msgid} X-GM-THRID ${x.thrid} INTERNALDATE "${x.date}" BODY[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] ${lit(x.head + '\r\n')} BODY[TEXT]<0> ${lit(x.body)})\r\n`));
          sock.write(`${tag} OK Success\r\n`);
        }
        else if (C === 'LOGOUT') { sock.write(`* BYE LOGOUT Requested\r\n${tag} OK 73 good day (Success)\r\n`); sock.end(); }
        else sock.write(`${tag} BAD Could not parse command\r\n`);
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, calls, close: () => srv.close() })));
}
