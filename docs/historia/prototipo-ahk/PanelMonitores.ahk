; ============================================================
;  Panel de monitores v2 — AutoHotkey v2 + MultiMonitorTool (NirSoft)
;  Dejá MultiMonitorTool.exe en la misma carpeta que este script.
;
;  Atajos:
;    Ctrl+Alt+T        Prende / apaga la tele
;    Ctrl+Alt+M        Abre / cierra el panel
;    Ctrl+Alt+1/2/3    Manda la ventana activa al monitor 1, 2 o 3 (de izquierda a derecha)
;    Ctrl+Alt+4        Pantalla completa (sin bordes) / volver a como estaba
;    Ctrl+Alt+5/6/7    Música: anterior / play-pausa / siguiente
; ============================================================
#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

INI := A_ScriptDir "\monitores.ini"
MMT := A_ScriptDir "\MultiMonitorTool.exe"
LNK := A_Startup "\Panel de monitores.lnk"
ESCALA := A_ScreenDPI / 96

; Paleta (tema oscuro)
C_BG := "16181F"
C_PANEL := "20232D"
C_MON := "2B3042"
C_WIN := "4A5878"
C_SEL := "FFB454"
C_ACCENT := "5B8CFF"
C_TEXT := "E6E8EF"
C_MUTED := "8B90A0"

gPanel := 0
gSel := 0
gLV := 0
gRects := Map()
gFull := Map()   ; ventanas en pantalla completa -> cómo estaban antes

if !FileExist(MMT) {
    MsgBox("No encuentro MultiMonitorTool.exe al lado del script.`n`n"
        . "Bajalo de nirsoft.net/utils/multi_monitor_tool.html y descomprimilo en:`n" A_ScriptDir,
        "Panel de monitores", "Icon!")
    ExitApp
}

RegistrarMonitores()
ArmarTray()

; ---------- Atajos ----------
^!t::AlternarTele()
^!m::MostrarPanel()
^!1::MoverActiva(1)
^!2::MoverActiva(2)
^!3::MoverActiva(3)
^!4::PantallaCompleta()
^!5::Send("{Media_Prev}")
^!6::Send("{Media_Play_Pause}")
^!7::Send("{Media_Next}")

; ---------- Utilidades ----------

P(n) => Round(n * ESCALA)
LimpiarNombre(name) => RegExReplace(name, ".*DISPLAY", "Pantalla ")
Recortar(s, n) => StrLen(s) > n ? SubStr(s, 1, n - 1) "…" : s
Aviso(txt) => TrayTip(txt, "Panel de monitores")

; Coordenadas reales aunque cada monitor tenga un escalado distinto
DpiReal() => DllCall("SetThreadDpiAwarenessContext", "ptr", -4, "ptr")
DpiVolver(old) => DllCall("SetThreadDpiAwarenessContext", "ptr", old, "ptr")

PantallaDe(act, cx, cy) {
    for i, m in act
        if (cx >= m.l && cx < m.r && cy >= m.t && cy < m.b)
            return i
    return 0
}

; ---------- Monitores ----------

; Monitores activos ordenados de izquierda a derecha
MonitoresActivos() {
    lista := []
    old := DpiReal()
    try {
        prim := MonitorGetPrimary()
        Loop MonitorGetCount() {
            MonitorGet(A_Index, &l, &t, &r, &b)
            lista.Push({idx: A_Index, name: MonitorGetName(A_Index)
                , l: l, t: t, r: r, b: b, primary: (A_Index = prim)})
        }
    } finally
        DpiVolver(old)
    Loop lista.Length - 1 {
        i := A_Index + 1
        while (i > 1 && lista[i-1].l > lista[i].l) {
            tmp := lista[i]
            lista[i] := lista[i-1]
            lista[i-1] := tmp
            i--
        }
    }
    return lista
}

; Guarda en el .ini los monitores que se vieron alguna vez (para poder prenderlos después)
RegistrarMonitores() {
    for m in MonitoresActivos()
        IniWrite((m.r - m.l) "x" (m.b - m.t), INI, "Conocidos", m.name)
}

Conocidos() {
    res := Map()
    try sec := IniRead(INI, "Conocidos")
    catch
        return res
    Loop Parse sec, "`n", "`r" {
        p := InStr(A_LoopField, "=")
        if p
            res[SubStr(A_LoopField, 1, p - 1)] := SubStr(A_LoopField, p + 1)
    }
    return res
}

EstaActivo(name) {
    for m in MonitoresActivos()
        if (m.name = name)
            return true
    return false
}

CambiarMonitor(name, prender, *) {
    if !prender {
        act := MonitoresActivos()
        if (act.Length <= 1) {
            MsgBox("Es la única pantalla activa, no la apago.", "Panel de monitores", "Icon!")
            return
        }
        for m in act
            if (m.name = name && m.primary) {
                MsgBox("Esa es la pantalla principal. Cambiá la principal en Windows antes de apagarla.",
                    "Panel de monitores", "Icon!")
                return
            }
    }
    RunWait('"' MMT '" ' (prender ? "/enable " : "/disable ") '"' name '"', , "Hide")
    Sleep 1500  ; Windows tarda un toque en reacomodar
    RegistrarMonitores()
    Aviso(LimpiarNombre(name) (prender ? " prendida" : " apagada"))
    Refrescar()
}

AlternarTele(*) {
    tele := IniRead(INI, "Config", "Tele", "")
    if (tele = "") {
        MostrarPanel()
        Aviso("Elegí en el panel cuál pantalla es la tele.")
        return
    }
    CambiarMonitor(tele, !EstaActivo(tele))
}

; Muestra un número grande en cada pantalla durante un momento
Identificar(*) {
    guis := []
    old := DpiReal()
    try {
        for i, m in MonitoresActivos() {
            o := Gui("+AlwaysOnTop -Caption +ToolWindow -DPIScale +E0x20")
            o.BackColor := C_ACCENT
            o.SetFont("s54 bold cFFFFFF", "Segoe UI")
            o.AddText("w" P(150) " h" P(130) " Center +0x200", i)
            o.Show("x" (m.l + 40) " y" (m.t + 40) " NoActivate")
            guis.Push(o)
        }
    } finally
        DpiVolver(old)
    SetTimer(CerrarTodas.Bind(guis), -1800)
}

CerrarTodas(lista, *) {
    for o in lista
        o.Destroy()
}

; ---------- Ventanas ----------

EsVentanaDeUsuario(hwnd) {
    if (gPanel && hwnd = gPanel.Hwnd)
        return false
    clase := WinGetClass(hwnd)
    if (clase = "Progman" || clase = "WorkerW" || clase = "Shell_TrayWnd" || clase = "Shell_SecondaryTrayWnd")
        return false
    ex := WinGetExStyle(hwnd)
    if ((ex & 0x80) && !(ex & 0x40000))         ; ventana de herramientas
        return false
    dueno := DllCall("GetWindow", "ptr", hwnd, "uint", 4, "ptr")
    if (dueno && !(ex & 0x40000))               ; ventana secundaria de otra
        return false
    cloaked := 0
    if (DllCall("dwmapi\DwmGetWindowAttribute", "ptr", hwnd, "uint", 14, "uint*", &cloaked, "uint", 4) = 0 && cloaked)
        return false                            ; ventanas "fantasma" de Windows
    return true
}

; Ventanas abiertas, de la de más arriba a la de más abajo
ListarVentanas() {
    lista := []
    old := DpiReal()
    try {
        act := MonitoresActivos()
        for hwnd in WinGetList() {
            try {
                if !EsVentanaDeUsuario(hwnd)
                    continue
                titulo := WinGetTitle(hwnd)
                if (titulo = "")
                    continue
                estado := WinGetMinMax(hwnd)
                x := 0, y := 0, w := 0, h := 0, scr := 0
                if (estado != -1) {
                    WinGetPos(&x, &y, &w, &h, hwnd)
                    scr := PantallaDe(act, x + w // 2, y + h // 2)
                }
                lista.Push({hwnd: hwnd, titulo: titulo
                    , proc: StrReplace(WinGetProcessName(hwnd), ".exe")
                    , estado: estado, x: x, y: y, w: w, h: h, scr: scr})
            }
        }
    } finally
        DpiVolver(old)
    return lista
}

MoverActiva(n) {
    h := WinExist("A")
    if (gPanel && h = gPanel.Hwnd)
        h := gSel
    if !MoverVentana(h, n)
        SoundBeep()
}

; Pantalla completa sin bordes sobre el monitor donde está la ventana; de nuevo = como estaba
PantallaCompleta() {
    global gFull
    hwnd := WinExist("A")
    if (!hwnd || !EsVentanaDeUsuario(hwnd)) {
        SoundBeep()
        return
    }
    old := DpiReal()
    try {
        if gFull.Has(hwnd) {
            f := gFull[hwnd]
            gFull.Delete(hwnd)
            WinSetStyle(f.style, hwnd)
            DllCall("SetWindowPos", "ptr", hwnd, "ptr", 0, "int", 0, "int", 0, "int", 0, "int", 0, "uint", 0x27)
            WinMove(f.x, f.y, f.w, f.h, hwnd)
            if (f.estado = 1)
                WinMaximize(hwnd)
            return
        }
        estado := WinGetMinMax(hwnd)
        if (estado != 0) {
            WinRestore(hwnd)
            Sleep 120
        }
        WinGetPos(&x, &y, &w, &h, hwnd)
        act := MonitoresActivos()
        n := PantallaDe(act, x + w // 2, y + h // 2)
        m := act[n ? n : 1]
        gFull[hwnd] := {style: WinGetStyle(hwnd), x: x, y: y, w: w, h: h, estado: estado}
        WinSetStyle("-0xC40000", hwnd)          ; sin barra de título ni borde
        DllCall("SetWindowPos", "ptr", hwnd, "ptr", 0, "int", 0, "int", 0, "int", 0, "int", 0, "uint", 0x27)
        WinMove(m.l, m.t, m.r - m.l, m.b - m.t, hwnd)
    } finally
        DpiVolver(old)
}

; Manda una ventana al monitor n (posición de izquierda a derecha). true si pudo.
MoverVentana(hwnd, n) {
    if (!hwnd || !WinExist(hwnd) || !EsVentanaDeUsuario(hwnd))
        return false
    old := DpiReal()
    try {
        act := MonitoresActivos()
        if (n < 1 || n > act.Length)
            return false
        dest := act[n]
        estado := WinGetMinMax(hwnd)
        if (estado = -1) {
            WinRestore(hwnd)
            Sleep 120
            estado := WinGetMinMax(hwnd)
        }
        WinGetPos(&x, &y, &w, &h, hwnd)
        orig := PantallaDe(act, x + w // 2, y + h // 2)
        MonitorGetWorkArea(dest.idx, &dl, &dt, &dr, &db)
        dw := dr - dl
        dh := db - dt
        if (estado = 1) {                       ; maximizada: restaurar, mover y volver a maximizar
            if (orig = n)
                return true
            WinRestore(hwnd)
            Sleep 120
            WinGetPos(&x, &y, &w, &h, hwnd)
            nw := Min(w, dw)
            nh := Min(h, dh)
            WinMove(dl + (dw - nw) // 2, dt + (dh - nh) // 2, nw, nh, hwnd)
            Sleep 60
            WinMaximize(hwnd)
            return true
        }
        if (orig = n)
            return true
        nw := Min(w, dw)
        nh := Min(h, dh)
        if (orig = 0) {                         ; estaba fuera de toda pantalla: centrar
            nx := dl + (dw - nw) // 2
            ny := dt + (dh - nh) // 2
        } else {                                ; conservar la posición relativa
            MonitorGetWorkArea(act[orig].idx, &ol, &ot, &or_, &ob)
            fx := (x - ol) / Max(1, or_ - ol)
            fy := (y - ot) / Max(1, ob - ot)
            nx := dl + Round(fx * dw)
            ny := dt + Round(fy * dh)
        }
        nx := Min(Max(nx, dl), dr - nw)
        ny := Min(Max(ny, dt), db - nh)
        WinMove(nx, ny, nw, nh, hwnd)
        return true
    } finally
        DpiVolver(old)
}

; Junta en la pantalla principal todo lo que quedó en otra (útil con la tele apagada)
TraerTodo(*) {
    act := MonitoresActivos()
    p := 1
    for i, m in act
        if m.primary
            p := i
    n := 0
    for v in ListarVentanas() {
        if (v.estado != -1 && v.scr != p) {
            if MoverVentana(v.hwnd, p)
                n++
        }
    }
    Aviso(n " ventana(s) traída(s) a la pantalla principal")
    Refrescar()
}

; ---------- Panel ----------

MostrarPanel(*) {
    global gPanel, gSel
    w := WinExist("A")
    if (gPanel && w = gPanel.Hwnd) {
        CerrarPanel()
        return
    }
    gSel := w
    ConstruirPanel()
}

CerrarPanel(*) {
    global gPanel
    if gPanel
        gPanel.Destroy()
    gPanel := 0
}

; Redibuja el panel un instante después (solo si sigue abierto)
Refrescar(*) {
    if gPanel
        SetTimer(RedibujarSiAbierto, -150)
}

RedibujarSiAbierto(*) {
    if gPanel
        ConstruirPanel()
}

TituloOscuro(hwnd) {
    try {
        v := Buffer(4, 0)
        NumPut("int", 1, v)
        DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 20, "ptr", v, "int", 4)
    }
}

Tema(ctrl) {
    try DllCall("uxtheme\SetWindowTheme", "ptr", ctrl.Hwnd, "str", "DarkMode_Explorer", "ptr", 0)
}

ConstruirPanel(*) {
    global gPanel, gSel, gLV, gRects
    pos := ""
    if gPanel {
        try {
            gPanel.GetPos(&px, &py)
            pos := "x" px " y" py " "
        }
        gPanel.Destroy()
        gPanel := 0
    }
    gRects := Map()

    act := MonitoresActivos()
    wins := ListarVentanas()
    tele := IniRead(INI, "Config", "Tele", "")
    botones := []

    g := Gui("+AlwaysOnTop -MaximizeBox -MinimizeBox -DPIScale", "Panel de monitores")
    g.BackColor := C_BG
    g.MarginX := P(20)
    g.MarginY := P(14)
    g.OnEvent("Close", CerrarPanel)
    g.OnEvent("Escape", CerrarPanel)
    g.SetFont("s10 c" C_TEXT, "Segoe UI")
    TituloOscuro(g.Hwnd)

    ; --- Encabezado ---
    t := g.AddText("xm ym w" P(400) " h" P(32) " +0x200", "Panel de monitores")
    t.SetFont("s16 bold c" C_TEXT, "Segoe UI")
    b := g.AddButton("x" P(430) " y" P(15) " w" P(100) " h" P(30), "Identificar")
    b.OnEvent("Click", Identificar)
    botones.Push(b)
    b := g.AddButton("x" P(540) " y" P(15) " w" P(100) " h" P(30), "Actualizar")
    b.OnEvent("Click", Refrescar)
    botones.Push(b)

    ; --- Mapa de pantallas ---
    g.AddText("x" P(20) " y" P(60) " w" P(620) " h" P(190) " Background" C_PANEL)

    minL := act[1].l
    minT := act[1].t
    maxR := act[1].r
    maxB := act[1].b
    for m in act {
        minL := Min(minL, m.l)
        minT := Min(minT, m.t)
        maxR := Max(maxR, m.r)
        maxB := Max(maxB, m.b)
    }
    areaX := P(34)
    areaY := P(74)
    areaW := P(592)
    areaH := P(162)
    esc := Min(areaW / (maxR - minL), areaH / (maxB - minT))
    offX := areaX + (areaW - (maxR - minL) * esc) / 2
    offY := areaY + (areaH - (maxB - minT) * esc) / 2

    ; Monitores (el principal lleva un borde de color)
    for i, m in act {
        mx := Round(offX + (m.l - minL) * esc) + 2
        my := Round(offY + (m.t - minT) * esc) + 2
        mw := Round((m.r - m.l) * esc) - 4
        mh := Round((m.b - m.t) * esc) - 4
        if m.primary
            g.AddText("x" (mx - 2) " y" (my - 2) " w" (mw + 4) " h" (mh + 4) " Background" C_ACCENT)
        r := g.AddText("x" mx " y" my " w" mw " h" mh " Background" C_MON)
        r.OnEvent("Click", ClickMonitor.Bind(i))
    }

    ; Ventanas dentro del mapa (la de más arriba se dibuja al final)
    Loop wins.Length {
        v := wins[wins.Length - A_Index + 1]
        if !v.scr
            continue
        m := act[v.scr]
        l := Max(v.x, m.l)
        tp := Max(v.y, m.t)
        rr := Min(v.x + v.w, m.r)
        bb := Min(v.y + v.h, m.b)
        if (rr <= l || bb <= tp)
            continue
        wx := Round(offX + (l - minL) * esc)
        wy := Round(offY + (tp - minT) * esc)
        ww := Max(6, Round((rr - l) * esc))
        wh := Max(6, Round((bb - tp) * esc))
        col := (v.hwnd = gSel) ? C_SEL : C_WIN
        ctl := g.AddText("x" wx " y" wy " w" ww " h" wh " Background" col)
        ctl.OnEvent("Click", ClickVentana.Bind(v.hwnd))
        gRects[v.hwnd] := ctl
    }

    ; Números de monitor (van arriba de todo, también sirven de botón "mandar acá")
    for i, m in act {
        mx := Round(offX + (m.l - minL) * esc) + 2
        my := Round(offY + (m.t - minT) * esc) + 2
        bd := g.AddText("x" (mx + 4) " y" (my + 4) " w" P(32) " h" P(24) " Center +0x200 cFFFFFF Background" C_ACCENT, i)
        bd.SetFont("s10 bold cFFFFFF", "Segoe UI")
        bd.OnEvent("Click", ClickMonitor.Bind(i))
    }

    hint := g.AddText("xm y" P(258) " w" P(620), "Tocá una ventana (en el mapa o en la lista) y después el número del monitor al que querés mandarla.")
    hint.SetFont("s9 c" C_MUTED, "Segoe UI")

    ; --- Lista de ventanas abiertas ---
    lv := g.AddListView("xm y+" P(8) " w" P(620) " r9 -Multi NoSort Background" C_PANEL " c" C_TEXT
        , ["Aplicación", "Título", "Pantalla", "hwnd"])
    gLV := lv
    lv.OnEvent("ItemSelect", FilaSel)
    lv.OnEvent("DoubleClick", FilaDoble)
    for v in wins {
        pant := (v.estado = -1) ? "min." : (v.scr ? String(v.scr) : "?")
        fila := lv.Add("", v.proc, v.titulo, pant, v.hwnd)
        if (v.hwnd = gSel)
            lv.Modify(fila, "Select Focus Vis")
    }
    lv.ModifyCol(1, P(130))
    lv.ModifyCol(2, P(372))
    lv.ModifyCol(3, P(80))
    lv.ModifyCol(4, 0)
    Tema(lv)

    ; --- Mover la ventana elegida ---
    g.AddText("xm y+" P(12) " w" P(150) " h" P(30) " +0x200 c" C_MUTED, "Mover ventana a:")
    for i, m in act {
        b := g.AddButton((i = 1 ? "x+0" : "x+" P(6)) " yp w" P(52) " h" P(30), String(i))
        b.OnEvent("Click", BotonMover.Bind(i))
        botones.Push(b)
    }
    b := g.AddButton("x" P(450) " yp w" P(190) " h" P(30), "Traer todo a la principal")
    b.OnEvent("Click", TraerTodo)
    botones.Push(b)

    ; --- Pantallas conocidas ---
    sec := g.AddText("xm y+" P(18) " w" P(300), "PANTALLAS")
    sec.SetFont("s9 bold c" C_MUTED, "Segoe UI")
    nombres := []
    for name, res in Conocidos() {
        nombres.Push(name)
        activo := false
        posN := 0
        prim := false
        for i, m in act {
            if (m.name = name) {
                activo := true
                posN := i
                prim := m.primary
            }
        }
        txt := (activo ? "●  " : "○  ") LimpiarNombre(name) "  ·  " res
        if activo
            txt .= "  ·  monitor " posN (prim ? " (principal)" : "")
        if (name = tele)
            txt .= "   ← TELE"
        colTxt := activo ? C_TEXT : C_MUTED
        g.AddText("xm y+" P(8) " w" P(500) " h" P(28) " +0x200 c" colTxt, txt)
        b := g.AddButton("x" P(540) " yp w" P(100) " h" P(28), activo ? "Apagar" : "Prender")
        b.OnEvent("Click", CambiarMonitor.Bind(name, !activo))
        if prim
            b.Enabled := false
        botones.Push(b)
    }

    ; --- Cuál es la tele ---
    g.AddText("xm y+" P(14) " h" P(26) " +0x200", "¿Cuál es la tele?")
    opciones := ["(ninguna)"]
    sel := 1
    for i, name in nombres {
        opciones.Push(LimpiarNombre(name))
        if (name = tele)
            sel := i + 1
    }
    dd := g.AddDropDownList("x+" P(10) " yp w" P(220) " Choose" sel, opciones)
    dd.OnEvent("Change", ElegirTele.Bind(nombres))
    Tema(dd)

    pie := g.AddText("xm y+" P(16) " w" P(620), "Ctrl+Alt+T tele  ·  M panel  ·  1/2/3 mover ventana  ·  4 pantalla completa  ·  5/6/7 música (anterior, play, siguiente)  ·  Esc cierra")
    pie.SetFont("s8 c" C_MUTED, "Segoe UI")

    for c in botones
        Tema(c)

    gPanel := g
    g.Show(pos "AutoSize")
}

; ---------- Eventos del panel ----------

FilaSel(ctrl, item, selected) {
    global gSel
    if (!selected || !item)
        return
    gSel := Integer(ctrl.GetText(item, 4))
    ResaltarMapa()
}

FilaDoble(ctrl, item) {
    if !item
        return
    try WinActivate(Integer(ctrl.GetText(item, 4)))
}

ResaltarMapa() {
    for hwnd, ctl in gRects {
        try {
            col := (hwnd = gSel) ? C_SEL : C_WIN
            ctl.Opt("Background" col)
            ctl.Redraw()
        }
    }
}

ClickVentana(hwnd, *) {
    global gSel
    gSel := hwnd
    Loop gLV.GetCount() {
        if (Integer(gLV.GetText(A_Index, 4)) = hwnd) {
            gLV.Modify(A_Index, "Select Focus Vis")
            break
        }
    }
    ResaltarMapa()
}

ClickMonitor(i, *) {
    if !gSel {
        Aviso("Primero elegí una ventana.")
        return
    }
    if !MoverVentana(gSel, i) {
        Aviso("No pude mover esa ventana.")
        return
    }
    Refrescar()
}

BotonMover(i, *) {
    ClickMonitor(i)
}

ElegirTele(nombres, ctrl, *) {
    IniWrite(ctrl.Value = 1 ? "" : nombres[ctrl.Value - 1], INI, "Config", "Tele")
    Refrescar()
}

; ---------- Bandeja ----------

ArmarTray() {
    A_IconTip := "Panel de monitores"
    t := A_TrayMenu
    t.Delete()
    t.Add("Abrir panel`tCtrl+Alt+M", MostrarPanel)
    t.Add("Prender/apagar tele`tCtrl+Alt+T", AlternarTele)
    t.Add("Identificar pantallas", Identificar)
    t.Add()
    t.Add("Iniciar con Windows", AlternarInicio)
    if FileExist(LNK)
        t.Check("Iniciar con Windows")
    t.Add()
    t.Add("Salir", (*) => ExitApp())
    t.Default := "Abrir panel`tCtrl+Alt+M"
    t.ClickCount := 1
}

AlternarInicio(item, pos, menu) {
    if FileExist(LNK) {
        FileDelete(LNK)
        menu.Uncheck(item)
    } else {
        FileCreateShortcut(A_ScriptFullPath, LNK, A_ScriptDir)
        menu.Check(item)
    }
}
