// 大地工作台・菜单栏小程序（每个人电脑上一个）。它只是个壳：
//   菜单栏上一个「大地 3」（3＝名下没做完的件数，有逾期变红）；点一下展开「我的今天」清单，再点收起。
//   清单是公司主机上的页面（<主机>/me），数据只有主机上那一份；这里不存任何任务。
//   壳做四件事：把钥匙交给页面／每分钟叫页面刷新一次／页面说「弹出来」时弹（早上、下班各一次）／
//   页面说「让 Claude 做」时把那句话复制好并把 Claude 调到前面／页面说「发送资料」时跑 ~/.dadi-brain/dadi send。
// 设置读 ~/.dadi-brain/config.json（url、key）。右键菜单：刷新・在浏览器里打开・退出。
// 编译：见同目录 build.sh（只用系统自带的 AppKit／WebKit，没有第三方库）。
import Cocoa
import WebKit

final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
  var item: NSStatusItem!
  let pop = NSPopover()
  var web: WKWebView!
  var timer: Timer?
  var loaded = false
  var sending = false
  let home = ProcessInfo.processInfo.environment["DADI_BRAIN_HOME"] ?? (NSHomeDirectory() + "/.dadi-brain")
  var snapshot: String? = nil

  func cfg() -> [String: Any] {
    guard let d = FileManager.default.contents(atPath: home + "/config.json"), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
    return j
  }
  func jsString(_ s: String) -> String {
    let d = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
    let t = String(data: d, encoding: .utf8) ?? "[\"\"]"
    return String(t.dropFirst().dropLast())
  }

  func applicationDidFinishLaunching(_ n: Notification) {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: "--snapshot"), i + 1 < a.count { snapshot = a[i + 1] }
    if snapshot == nil, let id = Bundle.main.bundleIdentifier {   // 已经开着一个了就退出。重装时旧的那个可能正在退出：等两秒再看
      let others = { NSRunningApplication.runningApplications(withBundleIdentifier: id).filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier && !$0.isTerminated }.count }
      if others() > 0 { Thread.sleep(forTimeInterval: 2); if others() > 0 { NSApp.terminate(nil); return } }
    }
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.title = "大地"
    item.button?.target = self
    item.button?.action = #selector(click(_:))
    item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    let conf = WKWebViewConfiguration()
    let uc = WKUserContentController()
    uc.add(self, name: "dadi")
    uc.addUserScript(WKUserScript(source: "window.DADI_KEY=\(jsString((cfg()["key"] as? String) ?? ""));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    conf.userContentController = uc
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 380, height: 620), configuration: conf)
    web.navigationDelegate = self
    let vc = NSViewController()
    vc.view = web
    pop.contentViewController = vc
    pop.contentSize = NSSize(width: 380, height: 620)
    pop.behavior = .transient
    reload()
    timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.tick() }
    if let out = snapshot {   // 只给检查用：把页面画成一张图就退出
      let w = NSWindow(contentRect: NSRect(x: -3000, y: -3000, width: 380, height: 620), styleMask: [.borderless], backing: .buffered, defer: false)
      pop.contentViewController = nil
      w.contentView = web
      w.orderFrontRegardless()
      if let i = a.firstIndex(of: "--eval"), i + 1 < a.count { let js = a[i + 1]; DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { self.web.evaluateJavaScript(js, completionHandler: nil) } }   // 检查用：先在页面里点一下再拍
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
        self.web.takeSnapshot(with: nil) { img, _ in
          if let t = img?.tiffRepresentation, let rep = NSBitmapImageRep(data: t), let png = rep.representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: out)) }
          print("title=\(self.item.button?.title ?? "") loaded=\(self.loaded)")
          exit(0)
        }
      }
    }
  }

  func reload() {
    let c = cfg()
    guard let u = c["url"] as? String, let url = URL(string: u.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/me") else {
      setTitle(open: -1, overdue: 0)
      web.loadHTMLString("<meta charset='utf-8'><body style='font:13px -apple-system;padding:24px;color:#4a4a4a;background:#f4f1ea'>这台电脑还没有接入大地工作台。<br><br>请先运行公司给的「接入」安装程序。</body>", baseURL: nil)
      return
    }
    web.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15))
  }
  func tick() { if loaded { web.evaluateJavaScript("window.dadiTick&&window.dadiTick()", completionHandler: nil) } else { reload() } }
  func webView(_ w: WKWebView, didFinish navigation: WKNavigation!) { loaded = w.url?.path == "/me" }
  func webView(_ w: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loaded = false; setTitle(open: -1, overdue: 0) }
  func webView(_ w: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    loaded = false; setTitle(open: -1, overdue: 0)
    web.loadHTMLString("<meta charset='utf-8'><body style='font:13px -apple-system;padding:24px;color:#4a4a4a;background:#f4f1ea'>连不上公司 Mac mini。<br><br>检查网络（在外面要开着 Tailscale），一分钟后会自己再试。</body>", baseURL: nil)
  }

  func setTitle(open: Int, overdue: Int) {
    guard let b = item.button else { return }
    let s = open < 0 ? "大地 –" : open == 0 ? "大地 ✓" : "大地 \(open)"
    let t = NSMutableAttributedString(string: s, attributes: [.font: NSFont.menuBarFont(ofSize: 0)])
    if open > 0 && overdue > 0 { t.addAttribute(.foregroundColor, value: NSColor.systemRed, range: NSRange(location: 3, length: s.count - 3)) }
    b.attributedTitle = t
    b.toolTip = open < 0 ? "连不上公司 Mac mini" : "要做 \(open) 件\(overdue > 0 ? "，逾期 \(overdue) 件" : "")"
  }

  func userContentController(_ uc: WKUserContentController, didReceive m: WKScriptMessage) {
    guard let d = m.body as? [String: Any], let type = d["type"] as? String else { return }
    switch type {
    case "count": setTitle(open: (d["open"] as? Int) ?? -1, overdue: (d["overdue"] as? Int) ?? 0)
    case "show": if snapshot == nil { showPop() }
    case "claude":
      let pb = NSPasteboard.general
      pb.clearContents()
      pb.setString((d["text"] as? String) ?? "", forType: .string)
      if let u = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.anthropic.claudefordesktop") {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { self.pop.performClose(nil); NSWorkspace.shared.openApplication(at: u, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil) }
      }
    case "send": runDadi(["send"], cb: "dadiSendDone")
    case "prepare": runDadi(["send", "--prepare", "--json"], cb: "dadiPrepared")
    case "talks":   // 本人点了「确认发送」：上传今天的精简对话，skip 里的几段不发
      let skip = ((d["skip"] as? [String]) ?? []).filter { $0.range(of: "^[A-Za-z0-9_-]{1,60}$", options: .regularExpression) != nil }
      runDadi(["talks", "--json"] + (skip.isEmpty ? [] : ["--skip", skip.joined(separator: ",")]), cb: "dadiTalksDone")   // 只整理今天的对话和备份，报告由本人在清单上看过再发
    case "open": if let u = d["url"] as? String, let url = URL(string: u), url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
    default: break
    }
  }

  func runDadi(_ args: [String], cb: String) {
    if sending { web.evaluateJavaScript("window.\(cb)&&window.\(cb)('{\"busy\":1}')", completionHandler: nil); return }
    sending = true
    let p = Process()
    p.executableURL = URL(fileURLWithPath: home + "/dadi")
    p.arguments = args
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = NSHomeDirectory() + "/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    env["DADI_NO_NOTIFY"] = "1"   // 结果在清单里说，不再另弹系统通知
    p.environment = env
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    p.terminationHandler = { [weak self] _ in
      let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
      DispatchQueue.main.async {
        guard let s = self else { return }
        s.sending = false
        s.web.evaluateJavaScript("window.\(cb)&&window.\(cb)(\(s.jsString(out.trimmingCharacters(in: .whitespacesAndNewlines))))", completionHandler: nil)
      }
    }
    do { try p.run() } catch {
      sending = false
      web.evaluateJavaScript("window.\(cb)&&window.\(cb)('')", completionHandler: nil)
    }
  }

  func showPop() {
    guard let b = item.button, !pop.isShown else { return }
    NSApp.activate(ignoringOtherApps: true)
    pop.show(relativeTo: b.bounds, of: b, preferredEdge: .minY)
    tick()
  }
  @objc func click(_ sender: Any?) {
    if NSApp.currentEvent?.type == .rightMouseUp {
      let menu = NSMenu()
      menu.addItem(withTitle: "刷新", action: #selector(menuReload), keyEquivalent: "r").target = self
      menu.addItem(withTitle: "在浏览器里打开", action: #selector(menuBrowser), keyEquivalent: "").target = self
      menu.addItem(.separator())
      menu.addItem(withTitle: "退出", action: #selector(menuQuit), keyEquivalent: "q").target = self
      item.menu = menu
      item.button?.performClick(nil)
      item.menu = nil
      return
    }
    if pop.isShown { pop.performClose(sender) } else { showPop() }
  }
  @objc func menuReload() { loaded = false; reload() }
  @objc func menuBrowser() { if let u = cfg()["url"] as? String, let url = URL(string: u + "/me") { NSWorkspace.shared.open(url) } }
  @objc func menuQuit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
