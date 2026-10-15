import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Download,
  FileText,
  Globe,
  HelpCircle,
  Layers,
  ListFilter,
  Maximize,
  Maximize2,
  Network,
  RefreshCw,
  RotateCcw,
  Scan,
  Search,
  Server,
  Share2,
  Sparkles,
  WifiOff,
  X,
  XCircle,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api } from '../services/api';
import {
  Wan2Lo0Node,
  Wan2Lo0AnalysisResult,
  Wan2Lo0Record,
  Wan2Lo0JsEdge,
  SingleTraceExecution,
  SegmentedMPLSTraceResponse,
  SegmentedOAMDomain,
  SegmentedOAMHop,
  InterfaceInspectionResponse,
  InterfaceHealthItem,
  BundleMemberDiagnostic,
  BundleSummary,
} from '../types';

declare global {
  interface Window {
    mermaid?: any;
  }
}

interface TracerouteViewProps {
  onSelectIncident: (incidentId: number) => void;
}

type InputTabMode = 'live' | 'asymmetric' | 'general';

interface SvgNodeState {
  id: string;
  el: SVGGElement;
  x: number;
  y: number;
  initX: number;
  initY: number;
  hw: number;
  hh: number;
}

interface SvgEdgeState {
  index: number;
  source: string;
  target: string;
  dev_a?: string | null;
  intf_a?: string | null;
  dev_b?: string | null;
  intf_b?: string | null;
  pathEl: SVGPathElement | null;
  labelEl: SVGGElement | null;
  initPathD: string;
  initLabelTransform: string;
  initLabelX: number;
  initLabelY: number;
  labelX: number;
  labelY: number;
  offsetX: number;
  offsetY: number;
  initOffsetX: number;
  initOffsetY: number;
  lw: number;
  lh: number;
}

export const TracerouteView: React.FC<TracerouteViewProps> = ({ onSelectIncident }) => {
  // Input Mode Tabs
  const [inputTab, setInputTab] = useState<InputTabMode>('asymmetric');

  // Paste / Text Mode States
  const [fwdText, setFwdText] = useState<string>('');
  const [retText, setRetText] = useState<string>('');
  const [genText, setGenText] = useState<string>('');
  const [autoPeer, setAutoPeer] = useState<boolean>(true);

  // Live Traceroute States
  const [traceType] = useState<'router_ssh' | 'server_os' | 'segmented_mpls_oam'>('segmented_mpls_oam');
  const [sourceRouterIp, setSourceRouterIp] = useState<string>('');
  const [targetIp, setTargetIp] = useState<string>('');
  const [sourceInterface, setSourceInterface] = useState<string>('Loopback0');
  const [autoReverse, setAutoReverse] = useState<boolean>(true);
  const [nodeOptions, setNodeOptions] = useState<Wan2Lo0Node[]>([]);
  const [nodeSearchQuery, setNodeSearchQuery] = useState<string>('');
  const [forwardTraceRaw, setForwardTraceRaw] = useState<SingleTraceExecution | null>(null);
  const [returnTraceRaw, setReturnTraceRaw] = useState<SingleTraceExecution | null>(null);
  const [segmentedTraceRaw, setSegmentedTraceRaw] = useState<SegmentedMPLSTraceResponse | null>(null);
  const [showRawCli, setShowRawCli] = useState<boolean>(false);

  // Analysis & Inspection States
  const [analysis, setAnalysis] = useState<Wan2Lo0AnalysisResult | null>(null);
  const [loadingAnalyze, setLoadingAnalyze] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Per-Interface Traffic Loss Inspector States
  const [inspection, setInspection] = useState<InterfaceInspectionResponse | null>(null);
  const [loadingInspect, setLoadingInspect] = useState<boolean>(false);
  const [measureDelta, setMeasureDelta] = useState<boolean>(true);
  const [expandedBundles, setExpandedBundles] = useState<Record<string, boolean>>({});

  const toggleBundleExpand = (key: string) => {
    setExpandedBundles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Table Filter & Toast
  const [tableFilter, setTableFilter] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showMermaidCodeModal, setShowMermaidCodeModal] = useState<boolean>(false);

  // Interactive SVG Diagram Refs & Viewport State
  const diagramContainerRef = useRef<HTMLDivElement | null>(null);
  const diagramViewportRef = useRef<HTMLDivElement | null>(null);
  const mermaidGraphRef = useRef<HTMLDivElement | null>(null);
  const [zoomPercent, setZoomPercent] = useState<number>(100);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const scaleRef = useRef<number>(1);
  const panXRef = useRef<number>(0);
  const panYRef = useRef<number>(0);
  const isPanningRef = useRef<boolean>(false);
  const panStartXRef = useRef<number>(0);
  const panStartYRef = useRef<number>(0);

  const nodeStateMapRef = useRef<Record<string, SvgNodeState>>({});
  const edgeStateListRef = useRef<SvgEdgeState[]>([]);
  const activeDragNodeRef = useRef<SvgNodeState | null>(null);
  const activeDragLabelRef = useRef<SvgEdgeState | null>(null);
  const dragLastClientXRef = useRef<number>(0);
  const dragLastClientYRef = useRef<number>(0);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2400);
  }, []);

  // Load initial router list for Live Traceroute selector
  useEffect(() => {
    api
      .searchWan2Lo0Nodes('', 60)
      .then((res) => setNodeOptions(res.nodes || []))
      .catch(() => {});
  }, []);

  // Search nodes when user types in filter
  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .searchWan2Lo0Nodes(nodeSearchQuery, 60)
        .then((res) => setNodeOptions(res.nodes || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [nodeSearchQuery]);

  const handleAnalyze = async (overrideMode?: 'general' | 'asymmetric') => {
    const targetMode =
      overrideMode || (inputTab === 'general' ? 'general' : 'asymmetric');
    const fwd = targetMode === 'asymmetric' ? fwdText.trim() : '';
    const ret = targetMode === 'asymmetric' ? retText.trim() : '';
    const gen = targetMode === 'general' ? genText.trim() : '';

    if (targetMode === 'asymmetric' && !fwd && !ret) {
      setErrorMsg('กรุณากรอกข้อมูล Traceroute ขาไป (Forward) หรือขากลับ (Return) ก่อนเริ่มวิเคราะห์');
      return;
    }
    if (targetMode === 'general' && !gen) {
      setErrorMsg('กรุณากรอกข้อมูล IP หรือ Traceroute ก่อนเริ่มวิเคราะห์');
      return;
    }

    setLoadingAnalyze(true);
    setErrorMsg(null);
    setInspection(null);

    try {
      const result = await api.analyzeWan2Lo0Topology({
        mode: targetMode,
        ipaddr: targetMode === 'general' ? gen : '',
        ipaddr_fwd: targetMode === 'asymmetric' ? fwd : '',
        ipaddr_ret: targetMode === 'asymmetric' ? ret : '',
        auto_peer: autoPeer,
      });
      setAnalysis(result);
    } catch (err: any) {
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการวิเคราะห์เส้นทาง');
    } finally {
      setLoadingAnalyze(false);
    }
  };

  const handleRunLiveTraceroute = async () => {
    if (!sourceRouterIp.trim() || !targetIp.trim()) {
      setErrorMsg('กรุณาระบุ Source Router (IP Loopback0) และ Destination Router / Target IP');
      return;
    }

    setLoadingAnalyze(true);
    setErrorMsg(null);
    setInspection(null);
    setForwardTraceRaw(null);
    setReturnTraceRaw(null);
    setSegmentedTraceRaw(null);

    try {
      if (traceType === 'segmented_mpls_oam') {
        const res = await api.runSegmentedMPLSTrace({
          source_router_ip: sourceRouterIp,
          target_ip: targetIp,
          max_domains: 5,
          auto_peer: autoPeer,
          auto_reverse: autoReverse,
        });

        setSegmentedTraceRaw(res);
        setAnalysis(res.analysis);
        if (res.formatted_text) {
          setFwdText(res.formatted_text);
        }
        if (res.return_formatted_text) {
          setRetText(res.return_formatted_text);
        }

        if (!res.success && res.error) {
          setErrorMsg(`Segmented MPLS OAM Notice: ${res.error}`);
        } else {
          showToast(
            `รัน Segmented MPLS OAM สำเร็จ (${res.total_domains} โดเมน, ${res.stitched_hops.length} Hops ใน ${res.total_elapsed_seconds}s)`
          );
        }
      } else {
        const res = await api.runLiveTraceroute({
          trace_type: traceType,
          source_router_ip: sourceRouterIp,
          target_ip: targetIp,
          source_interface: sourceInterface,
          auto_reverse: traceType === 'router_ssh' ? autoReverse : false,
          auto_peer: autoPeer,
          max_hops: 25,
        });

        setForwardTraceRaw(res.forward_trace);
        setReturnTraceRaw(res.return_trace || null);
        setAnalysis(res.analysis);

        if (res.forward_trace?.formatted_text) {
          setFwdText(res.forward_trace.formatted_text);
        }
        if (res.return_trace?.formatted_text) {
          setRetText(res.return_trace.formatted_text);
        }
        if (!res.forward_trace.success && res.forward_trace.error) {
          setErrorMsg(`Live Traceroute Notice: ${res.forward_trace.error}`);
        } else {
          showToast('รัน Live Traceroute และสร้าง Topology สำเร็จ');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการรัน Live Traceroute');
    } finally {
      setLoadingAnalyze(false);
    }
  };

  const handleInspectInterfaces = async () => {
    if (!analysis || !analysis.topology_interfaces.length) {
      showToast('ไม่มีรายการ Interface ใน Topology สำหรับตรวจสอบ');
      return;
    }
    setLoadingInspect(true);
    setErrorMsg(null);
    try {
      const res = await api.inspectTopologyInterfaces({
        targets: analysis.topology_interfaces,
        measure_delta: measureDelta,
        delta_interval_sec: 15.0,
      });
      setInspection(res);
      showToast(
        `ตรวจสอบครบ ${res.summary.total_checked} พอร์ต (${res.elapsed_seconds}s)`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการตรวจสอบ Interface Health');
    } finally {
      setLoadingInspect(false);
    }
  };



  // ============================================================================
  // Interactive Mermaid Topology Rendering, Node Dragging, Zoom/Pan & 2x JPG Export
  // ============================================================================
  const updateViewportTransform = useCallback(() => {
    const container = diagramContainerRef.current;
    const svg = mermaidGraphRef.current?.querySelector('svg');
    if (container && svg) {
      const cRect = container.getBoundingClientRect();
      const cW = Math.max(100, cRect.width || 1000);
      const cH = Math.max(100, cRect.height || 540);
      const sc = Math.max(0.05, scaleRef.current || 1);
      const vbX = -panXRef.current / sc;
      const vbY = -panYRef.current / sc;
      const vbW = cW / sc;
      const vbH = cH / sc;
      svg.setAttribute(
        'viewBox',
        `${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}`
      );
    }
    setZoomPercent(Math.round(scaleRef.current * 100));
  }, []);

  const parseTranslate = (el: Element | null): { x: number; y: number } => {
    if (!el) return { x: 0, y: 0 };
    const t = el.getAttribute('transform') || '';
    const m = t.match(/translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/);
    if (m) {
      return {
        x: parseFloat(m[1]) || 0,
        y: parseFloat(m[2]) || 0,
      };
    }
    return { x: 0, y: 0 };
  };

  const extractLogicalNodeId = (nodeEl: Element): string => {
    const htmlEl = nodeEl as HTMLElement;
    if (htmlEl.dataset && htmlEl.dataset.id) return htmlEl.dataset.id;
    const rawId = nodeEl.id || '';
    const m1 = rawId.match(/^flowchart-([A-Za-z0-9_]+)-\d+$/);
    if (m1) return m1[1];
    const m2 = rawId.match(/^([A-Za-z0-9_]+)-\d+$/);
    if (m2) return m2[1];
    return rawId;
  };

  const getBoxIntersection = (
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    targetX: number,
    targetY: number
  ) => {
    const dx = targetX - cx;
    const dy = targetY - cy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return { x: cx, y: cy };
    }
    const sx = hw / Math.abs(dx || 0.001);
    const sy = hh / Math.abs(dy || 0.001);
    const s = Math.min(sx, sy);
    return {
      x: cx + dx * s,
      y: cy + dy * s,
    };
  };

  const recomputeEdgePath = useCallback((edge: SvgEdgeState) => {
    const src = nodeStateMapRef.current[edge.source];
    const dst = nodeStateMapRef.current[edge.target];
    if (!src || !dst || !edge.pathEl) return;

    const startPt = getBoxIntersection(
      src.x,
      src.y,
      src.hw + 4,
      src.hh + 4,
      edge.labelX,
      edge.labelY
    );
    const endPt = getBoxIntersection(
      dst.x,
      dst.y,
      dst.hw + 6,
      dst.hh + 6,
      edge.labelX,
      edge.labelY
    );

    const ctrlX = 2 * edge.labelX - 0.5 * (startPt.x + endPt.x);
    const ctrlY = 2 * edge.labelY - 0.5 * (startPt.y + endPt.y);

    const d = `M ${startPt.x.toFixed(2)},${startPt.y.toFixed(2)} Q ${ctrlX.toFixed(
      2
    )},${ctrlY.toFixed(2)} ${endPt.x.toFixed(2)},${endPt.y.toFixed(2)}`;
    edge.pathEl.setAttribute('d', d);
  }, []);

  const updateEdgesForNode = useCallback(
    (nodeId: string) => {
      edgeStateListRef.current.forEach((edge) => {
        if (edge.source === nodeId || edge.target === nodeId) {
          const src = nodeStateMapRef.current[edge.source];
          const dst = nodeStateMapRef.current[edge.target];
          if (src && dst) {
            edge.labelX = (src.x + dst.x) / 2 + edge.offsetX;
            edge.labelY = (src.y + dst.y) / 2 + edge.offsetY;
            if (edge.labelEl) {
              edge.labelEl.setAttribute(
                'transform',
                `translate(${edge.labelX.toFixed(2)}, ${edge.labelY.toFixed(2)})`
              );
            }
            recomputeEdgePath(edge);
          }
        }
      });
    },
    [recomputeEdgePath]
  );

  const fitDiagramToScreen = useCallback(() => {
    const container = diagramContainerRef.current;
    const svg = mermaidGraphRef.current?.querySelector('svg');
    if (!container || !svg) return;

    const cRect = container.getBoundingClientRect();
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    Object.values(nodeStateMapRef.current).forEach((n) => {
      minX = Math.min(minX, n.x - n.hw);
      minY = Math.min(minY, n.y - n.hh);
      maxX = Math.max(maxX, n.x + n.hw);
      maxY = Math.max(maxY, n.y + n.hh);
    });
    edgeStateListRef.current.forEach((e) => {
      minX = Math.min(minX, e.labelX - e.lw);
      minY = Math.min(minY, e.labelY - e.lh);
      maxX = Math.max(maxX, e.labelX + e.lw);
      maxY = Math.max(maxY, e.labelY + e.lh);
    });

    const contentW = isFinite(minX) ? Math.max(120, maxX - minX) : 1000;
    const contentH = isFinite(minY) ? Math.max(80, maxY - minY) : 500;
    const centerX = isFinite(minX) ? (minX + maxX) / 2 : contentW / 2;
    const centerY = isFinite(minY) ? (minY + maxY) / 2 : contentH / 2;

    const availW = Math.max(200, cRect.width - 80);
    const availH = Math.max(200, cRect.height - 90);
    const fitScale = Math.min(availW / contentW, availH / contentH, 1.25);

    scaleRef.current = Math.min(5.0, Math.max(0.1, fitScale));
    panXRef.current = cRect.width / 2 - centerX * scaleRef.current;
    panYRef.current = cRect.height / 2 - centerY * scaleRef.current;
    updateViewportTransform();
  }, [updateViewportTransform]);

  const zoomAtPoint = useCallback(
    (newScale: number, clientX: number, clientY: number) => {
      const container = diagramContainerRef.current;
      if (!container) return;
      const clamped = Math.min(5.0, Math.max(0.1, newScale));
      const rect = container.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;

      const ratio = clamped / scaleRef.current;
      panXRef.current = relX - (relX - panXRef.current) * ratio;
      panYRef.current = relY - (relY - panYRef.current) * ratio;
      scaleRef.current = clamped;
      updateViewportTransform();
    },
    [updateViewportTransform]
  );

  const initInteractiveTopology = useCallback(
    (svg: SVGSVGElement, edgesMeta: Wan2Lo0JsEdge[]) => {
      nodeStateMapRef.current = {};
      edgeStateListRef.current = [];

      svg.style.maxWidth = 'none';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.display = 'block';
      svg.style.overflow = 'visible';
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');

      svg.querySelectorAll('foreignObject').forEach((fo) => {
        (fo as HTMLElement).style.overflow = 'visible';
      });

      const nodeEls = svg.querySelectorAll('g.nodes > g.node');
      nodeEls.forEach((nodeEl) => {
        const gEl = nodeEl as SVGGElement;
        gEl.style.cursor = 'move';
        const nodeId = extractLogicalNodeId(gEl);
        const pos = parseTranslate(gEl);
        let hw = 80;
        let hh = 36;
        try {
          const bbox = gEl.getBBox();
          if (bbox.width > 0) hw = bbox.width / 2;
          if (bbox.height > 0) hh = bbox.height / 2;
        } catch (_) {}

        const state: SvgNodeState = {
          id: nodeId,
          el: gEl,
          x: pos.x,
          y: pos.y,
          initX: pos.x,
          initY: pos.y,
          hw,
          hh,
        };
        nodeStateMapRef.current[nodeId] = state;

        gEl.addEventListener('mousedown', (e: MouseEvent) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          activeDragNodeRef.current = state;
          dragLastClientXRef.current = e.clientX;
          dragLastClientYRef.current = e.clientY;
        });
      });

      const pathEls = svg.querySelectorAll('g.edgePaths > path');
      const labelEls = svg.querySelectorAll('g.edgeLabels > g.edgeLabel');

      edgesMeta.forEach((edgeMeta) => {
        const idx = edgeMeta.index;
        const pathEl = (pathEls[idx] as SVGPathElement) || null;
        const labelEl = (labelEls[idx] as SVGGElement) || null;
        const labelPos = parseTranslate(labelEl);

        let lw = 90;
        let lh = 28;
        if (labelEl) {
          labelEl.style.cursor = 'move';
          try {
            const lbbox = labelEl.getBBox();
            if (lbbox.width > 0) lw = lbbox.width / 2;
            if (lbbox.height > 0) lh = lbbox.height / 2;
          } catch (_) {}
        }

        const src = nodeStateMapRef.current[edgeMeta.source];
        const dst = nodeStateMapRef.current[edgeMeta.target];
        const midX = src && dst ? (src.x + dst.x) / 2 : labelPos.x;
        const midY = src && dst ? (src.y + dst.y) / 2 : labelPos.y;

        const edgeState: SvgEdgeState = {
          index: idx,
          source: edgeMeta.source,
          target: edgeMeta.target,
          dev_a: edgeMeta.dev_a,
          intf_a: edgeMeta.intf_a,
          dev_b: edgeMeta.dev_b,
          intf_b: edgeMeta.intf_b,
          pathEl,
          labelEl,
          initPathD: pathEl ? pathEl.getAttribute('d') || '' : '',
          initLabelTransform: labelEl ? labelEl.getAttribute('transform') || '' : '',
          initLabelX: labelPos.x,
          initLabelY: labelPos.y,
          labelX: labelPos.x,
          labelY: labelPos.y,
          offsetX: labelPos.x - midX,
          offsetY: labelPos.y - midY,
          initOffsetX: labelPos.x - midX,
          initOffsetY: labelPos.y - midY,
          lw,
          lh,
        };
        edgeStateListRef.current.push(edgeState);

        if (labelEl) {
          labelEl.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            activeDragLabelRef.current = edgeState;
            dragLastClientXRef.current = e.clientX;
            dragLastClientYRef.current = e.clientY;
          });
        }
      });

      setTimeout(fitDiagramToScreen, 40);
    },
    [fitDiagramToScreen]
  );

  // Render Mermaid diagram whenever analysis.mermaid_code changes
  useEffect(() => {
    const container = mermaidGraphRef.current;
    if (!container || !analysis?.mermaid_code) return;

    const renderGraph = async () => {
      if (!window.mermaid) return;
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: 'basis',
          },
        });
        const uniqueSvgId = `wan2lo0Svg_${Date.now()}`;
        const res = await window.mermaid.render(uniqueSvgId, analysis.mermaid_code);
        container.innerHTML = res.svg;
        const svg = container.querySelector('svg');
        if (svg) {
          initInteractiveTopology(svg as SVGSVGElement, analysis.js_edges || []);
        }
      } catch (err: any) {
        container.innerHTML = `<div class="p-4 text-red-400 text-sm">Error rendering Mermaid diagram: ${
          err?.message || err
        }</div>`;
      }
    };

    renderGraph();
  }, [analysis, initInteractiveTopology]);

  // Overlay Interface Inspection Health Status colors directly onto Mermaid SVG edges
  useEffect(() => {
    if (!inspection || !edgeStateListRef.current.length) return;
    const byKey = inspection.by_key || {};

    edgeStateListRef.current.forEach((edge) => {
      if (!edge.pathEl) return;
      const keyA = edge.dev_a && edge.intf_a ? `${edge.dev_a}:${edge.intf_a}` : '';
      const keyB = edge.dev_b && edge.intf_b ? `${edge.dev_b}:${edge.intf_b}` : '';
      const resA = keyA ? byKey[keyA] : undefined;
      const resB = keyB ? byKey[keyB] : undefined;

      const statuses = [resA?.health_status, resB?.health_status].filter(Boolean);
      if (statuses.includes('CRITICAL')) {
        edge.pathEl.style.stroke = '#ef4444';
        edge.pathEl.style.strokeWidth = '4.5px';
        edge.pathEl.style.filter = 'drop-shadow(0 0 6px rgba(239,68,68,0.75))';
      } else if (statuses.includes('WARNING')) {
        edge.pathEl.style.stroke = '#f59e0b';
        edge.pathEl.style.strokeWidth = '3.8px';
        edge.pathEl.style.filter = 'drop-shadow(0 0 4px rgba(245,158,11,0.5))';
      } else if (statuses.includes('HEALTHY')) {
        edge.pathEl.style.stroke = '#10b981';
        edge.pathEl.style.strokeWidth = '3.2px';
        edge.pathEl.style.filter = 'none';
      }
    });
  }, [inspection]);

  // Global mouse move / up listeners for dragging nodes, labels, and panning canvas
  useEffect(() => {
    const getSvgDelta = (clientDx: number, clientDy: number) => {
      const sc = Math.max(0.05, scaleRef.current || 1);
      return { dx: clientDx / sc, dy: clientDy / sc };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (activeDragNodeRef.current) {
        const node = activeDragNodeRef.current;
        const delta = getSvgDelta(
          e.clientX - dragLastClientXRef.current,
          e.clientY - dragLastClientYRef.current
        );
        dragLastClientXRef.current = e.clientX;
        dragLastClientYRef.current = e.clientY;
        node.x += delta.dx;
        node.y += delta.dy;
        node.el.setAttribute(
          'transform',
          `translate(${node.x.toFixed(2)}, ${node.y.toFixed(2)})`
        );
        updateEdgesForNode(node.id);
        return;
      }

      if (activeDragLabelRef.current) {
        const edge = activeDragLabelRef.current;
        const delta = getSvgDelta(
          e.clientX - dragLastClientXRef.current,
          e.clientY - dragLastClientYRef.current
        );
        dragLastClientXRef.current = e.clientX;
        dragLastClientYRef.current = e.clientY;
        edge.labelX += delta.dx;
        edge.labelY += delta.dy;
        const src = nodeStateMapRef.current[edge.source];
        const dst = nodeStateMapRef.current[edge.target];
        if (src && dst) {
          edge.offsetX = edge.labelX - (src.x + dst.x) / 2;
          edge.offsetY = edge.labelY - (src.y + dst.y) / 2;
        }
        if (edge.labelEl) {
          edge.labelEl.setAttribute(
            'transform',
            `translate(${edge.labelX.toFixed(2)}, ${edge.labelY.toFixed(2)})`
          );
        }
        recomputeEdgePath(edge);
        return;
      }

      if (isPanningRef.current) {
        panXRef.current = e.clientX - panStartXRef.current;
        panYRef.current = e.clientY - panStartYRef.current;
        updateViewportTransform();
      }
    };

    const handleMouseUp = () => {
      activeDragNodeRef.current = null;
      activeDragLabelRef.current = null;
      isPanningRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [recomputeEdgePath, updateEdgesForNode, updateViewportTransform]);

  const handleResetNodePositions = () => {
    Object.values(nodeStateMapRef.current).forEach((node) => {
      node.x = node.initX;
      node.y = node.initY;
      node.el.setAttribute('transform', `translate(${node.initX}, ${node.initY})`);
    });

    edgeStateListRef.current.forEach((edge) => {
      edge.labelX = edge.initLabelX;
      edge.labelY = edge.initLabelY;
      edge.offsetX = edge.initOffsetX;
      edge.offsetY = edge.initOffsetY;
      if (edge.pathEl && edge.initPathD) {
        edge.pathEl.setAttribute('d', edge.initPathD);
      }
      if (edge.labelEl) {
        edge.labelEl.setAttribute('transform', edge.initLabelTransform);
      }
    });
    fitDiagramToScreen();
    showToast('รีเซ็ตตำแหน่งโหนดกลับสู่ค่าเริ่มต้นแล้ว');
  };

  const handleDownloadJPG = () => {
    const svg = mermaidGraphRef.current?.querySelector('svg');
    if (!svg) {
      showToast('ยังไม่มีไดอะแกรมให้ดาวน์โหลด');
      return;
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    Object.values(nodeStateMapRef.current).forEach((n) => {
      minX = Math.min(minX, n.x - n.hw);
      minY = Math.min(minY, n.y - n.hh);
      maxX = Math.max(maxX, n.x + n.hw);
      maxY = Math.max(maxY, n.y + n.hh);
    });
    edgeStateListRef.current.forEach((e) => {
      minX = Math.min(minX, e.labelX - e.lw);
      minY = Math.min(minY, e.labelY - e.lh);
      maxX = Math.max(maxX, e.labelX + e.lw);
      maxY = Math.max(maxY, e.labelY + e.lh);
    });

    const margin = 40;
    const bounds = isFinite(minX)
      ? {
          x: Math.floor(minX - margin),
          y: Math.floor(minY - margin),
          width: Math.ceil(maxX - minX + margin * 2),
          height: Math.ceil(maxY - minY + margin * 2),
        }
      : { x: 0, y: 0, width: 1200, height: 800 };

    const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
    clonedSvg.setAttribute(
      'viewBox',
      `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`
    );
    clonedSvg.setAttribute('width', String(bounds.width));
    clonedSvg.setAttribute('height', String(bounds.height));
    if (!clonedSvg.getAttribute('xmlns')) {
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    const svgString = new XMLSerializer().serializeToString(clonedSvg);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bounds.width * scale);
      canvas.height = Math.round(bounds.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'network_topology.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('ดาวน์โหลดภาพ network_topology.jpg (2x) สำเร็จ');
    };
    img.src = url;
  };

  const handleExportCSV = () => {
    if (!analysis || !analysis.records_all.length) return;
    const headers = [
      'Direction',
      'Hop/Type',
      'WAN IP',
      'Subnet',
      'Interface',
      'Loopback0',
      'Hostname',
      'Model',
      'Area',
      'Circuit ID',
      'RTT (ms)',
      'Description',
    ];
    const rows = analysis.records_all.map((r) => [
      r.direction,
      r.is_auto_peer ? 'Auto-Peer' : 'Input Hop',
      r.ip_address,
      r.subnet,
      r.interface,
      r.ip_loopback,
      r.hostname,
      r.model,
      r.area,
      r.circuit,
      r.rtt_ms ?? '',
      (r.description || '').replace(/"/g, '""'),
    ]);
    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map((row) => row.map((c) => `"${c}"`).join(','))].join(
        '\n'
      );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'network_path_export.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('ส่งออกไฟล์ CSV เรียบร้อยแล้ว');
  };

  const filterRecords = (list: Wan2Lo0Record[]) => {
    if (!tableFilter.trim()) return list;
    const q = tableFilter.toLowerCase();
    return list.filter(
      (r) =>
        r.ip_address.toLowerCase().includes(q) ||
        r.ip_loopback.toLowerCase().includes(q) ||
        (r.hostname || '').toLowerCase().includes(q) ||
        (r.interface || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.circuit || '').toLowerCase().includes(q) ||
        (r.area || '').toLowerCase().includes(q)
    );
  };

  const renderHealthBadge = (item?: InterfaceHealthItem) => {
    if (!item) return null;
    if (item.health_status === 'CRITICAL') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          <span>CRITICAL {item.is_active_loss ? '(ACTIVE LOSS)' : ''}</span>
        </span>
      );
    }
    if (item.health_status === 'WARNING') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span>WARNING</span>
        </span>
      );
    }
    if (item.health_status === 'HEALTHY') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>HEALTHY</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground border border-border">
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        <span>UNREACHABLE</span>
      </span>
    );
  };

  const renderRecordRow = (rec: Wan2Lo0Record, idx: number) => {
    const inspectItem =
      inspection?.by_key?.[`${rec.ip_loopback}:${rec.interface}`];
    return (
      <tr
        key={`${rec.ip_address}-${idx}`}
        className="border-b border-border/50 hover:bg-muted/30 transition-colors text-[11px] leading-tight"
      >
        <td className="px-2 py-1 font-semibold whitespace-nowrap">
          <span
            className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${
              rec.is_auto_peer
                ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
            }`}
          >
            {rec.hop_label || (rec.is_auto_peer ? 'Peer' : `Hop ${idx + 1}`)}
          </span>
          {rec.rtt_ms !== undefined && rec.rtt_ms !== null && (
            <span className="ml-1 text-[10px] font-mono text-emerald-400">
              {rec.rtt_ms}ms
            </span>
          )}
        </td>
        <td className="px-2 py-1 font-mono whitespace-nowrap">
          <button
            onClick={() => {
              navigator.clipboard.writeText(rec.ip_address);
              showToast(`คัดลอก IP: ${rec.ip_address}`);
            }}
            className="text-sky-400 hover:underline font-medium"
            title="คลิกเพื่อคัดลอก IP WAN"
          >
            {rec.ip_address}
          </button>
          {rec.subnet && (
            <span className="ml-1 text-[10px] text-muted-foreground">
              ({rec.subnet})
            </span>
          )}
        </td>
        <td className="px-2 py-1 font-mono whitespace-nowrap">
          <span className="text-foreground font-medium">
            {rec.interface}
          </span>
          {inspectItem?.is_bundle && (
            <span
              className={`ml-1.5 px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                inspectItem.bundle_summary?.degraded
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                  : 'bg-primary/15 text-primary border-primary/20'
              }`}
              title={
                inspectItem.bundle_summary
                  ? `LAG: ${inspectItem.bundle_summary.active_links}/${inspectItem.bundle_summary.total_links} Links Active`
                  : 'LAG Bundle'
              }
            >
              LAG {inspectItem.bundle_summary ? `${inspectItem.bundle_summary.active_links}/${inspectItem.bundle_summary.total_links}` : ''}
            </span>
          )}
          {inspectItem && <span className="ml-1.5">{renderHealthBadge(inspectItem)}</span>}
        </td>
        <td className="px-2 py-1 whitespace-nowrap">
          <span className="font-semibold text-foreground">
            {rec.hostname || rec.ip_loopback}
          </span>
          {rec.active_incidents && rec.active_incidents.length > 0 && (
            <span className="ml-1.5 inline-flex flex-wrap gap-1">
              {rec.active_incidents.map((inc) => (
                <button
                  key={inc.id}
                  onClick={() => onSelectIncident(inc.id)}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 transition"
                >
                  🚨 {inc.osticket_id || inc.tts_id || inc.incident_number}
                </button>
              ))}
            </span>
          )}
        </td>
        <td className="px-2 py-1 whitespace-nowrap">
          <button
            onClick={() => {
              navigator.clipboard.writeText(rec.ip_loopback);
              showToast(`คัดลอก Loopback0: ${rec.ip_loopback}`);
            }}
            className="font-mono text-emerald-400 hover:underline font-medium"
          >
            {rec.ip_loopback}
          </button>
          {rec.model && (
            <span className="ml-1 text-[10px] text-muted-foreground">
              ({rec.model})
            </span>
          )}
          {rec.area && (
            <span className="ml-1 px-1 py-0.2 rounded bg-blue-500/10 text-blue-400 text-[10px]">
              {rec.area}
            </span>
          )}
        </td>
        <td className="px-2 py-1 text-muted-foreground break-all">
          {rec.description || '-'}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-card text-foreground border border-border px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-sm animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2.5">
            <span>Network Path &amp; Traceroute Analyzer</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
              Wan2Loopback v3.1 + Live Diagnostics
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            แปลง IP WAN เป็น Loopback0 Topology • Live MPLS OAM Tracing • ตรวจสอบสุขภาพพอร์ตและวิเคราะห์ Traffic Loss
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {analysis && analysis.topology_interfaces.length > 0 && (
            <button
              onClick={handleInspectInterfaces}
              disabled={loadingInspect}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
            >
              <Activity className={`w-3.5 h-3.5 ${loadingInspect ? 'animate-spin' : ''}`} />
              <span>
                {loadingInspect
                  ? 'กำลังตรวจสอบทุกพอร์ต...'
                  : `ตรวจสุขภาพพอร์ต (${analysis.topology_interfaces.length} พอร์ต)`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Control Panel Card */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
        {/* Mode Switcher Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setInputTab('asymmetric')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                inputTab === 'asymmetric'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>เปรียบเทียบ ขาไป (Forward) / ขากลับ (Return)</span>
            </button>
            <button
              onClick={() => setInputTab('live')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                inputTab === 'live'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>สั่งยิง Live Traceroute จริงใน Network</span>
            </button>
            <button
              onClick={() => setInputTab('general')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                inputTab === 'general'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>โหมดรวมช่องเดียว (General / #FORWARD #RETURN)</span>
            </button>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoPeer}
              onChange={(e) => setAutoPeer(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <span>ค้นหาคู่สาย Peer IP อัตโนมัติ (/30 และ /31)</span>
          </label>
        </div>

        {/* Mode 1: Asymmetric Forward / Return Textareas */}
        {inputTab === 'asymmetric' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-500" />
                    <span>เส้นทางขาไป (Forward Path: ต้นทาง ➔ ปลายทาง)</span>
                  </label>
                  <button
                    onClick={() => setFwdText('')}
                    className="text-[11px] text-muted-foreground hover:text-red-400"
                  >
                    ล้างช่องนี้
                  </button>
                </div>
                <textarea
                  rows={5}
                  value={fwdText}
                  onChange={(e) => setFwdText(e.target.value)}
                  placeholder="วางผล Traceroute ขาไป หรือรายการ IP WAN..."
                  className="w-full rounded-xl bg-background border border-sky-500/30 p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-orange-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-orange-400" />
                    <span>เส้นทางขากลับ (Return Path: ปลายทาง ➔ ต้นทาง)</span>
                  </label>
                  <button
                    onClick={() => setRetText('')}
                    className="text-[11px] text-muted-foreground hover:text-red-400"
                  >
                    ล้างช่องนี้
                  </button>
                </div>
                <textarea
                  rows={5}
                  value={retText}
                  onChange={(e) => setRetText(e.target.value)}
                  placeholder="วางผล Traceroute ขากลับ หรือรายการ IP WAN..."
                  className="w-full rounded-xl bg-background border border-orange-500/30 p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setFwdText('');
                  setRetText('');
                }}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition"
              >
                ล้างทั้งหมด
              </button>
              <button
                onClick={() => handleAnalyze('asymmetric')}
                disabled={loadingAnalyze}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition flex items-center gap-2 disabled:opacity-50"
              >
                <Search className={`w-3.5 h-3.5 ${loadingAnalyze ? 'animate-spin' : ''}`} />
                <span>{loadingAnalyze ? 'กำลังวิเคราะห์...' : 'วิเคราะห์เส้นทางและสร้าง Topology'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Mode 2: Live Network Traceroute Engine */}
        {inputTab === 'live' && (
          <div className="space-y-4">
            <div className="p-3.5 bg-primary/5 border border-primary/20 rounded-xl text-xs text-foreground flex items-start gap-2.5">
              <Globe className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-primary">Segmented MPLS OAM (Intra-Domain &amp; Cross-Domain BGP-LU):</span> รองรับทั้งเส้นทางในโดเมนเดียวกันและข้ามหลายโดเมนอัตโนมัติ ตรวจจับ OS ของเราเตอร์ (IOS-XR, IOS-XE, Classic IOS 7600), วิ่ง Query BGP Next-Hop ที่ ABR และสั่ง <code className="font-mono text-primary bg-primary/10 px-1 py-0.5 rounded">traceroute mpls ipv4 ... source &lt;Loopback0&gt;</code> พร้อมต่อเชื่อมเส้นทางและ Label Stacks ให้ครบถ้วน
              </div>
            </div>

            {/* Router Search Filter helper */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Source Router (IP Loopback0)
                </label>
                <input
                  type="text"
                  list="wan2lo0-nodes-datalist"
                  value={sourceRouterIp}
                  onChange={(e) => {
                    setSourceRouterIp(e.target.value);
                    setNodeSearchQuery(e.target.value);
                  }}
                  placeholder="เช่น 10.5.200.7 หรือ 10.5.0.2"
                  className="w-full rounded-lg bg-background border border-border px-3 py-2 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary/40 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Destination Router / Target IP
                </label>
                <input
                  type="text"
                  list="wan2lo0-nodes-datalist"
                  value={targetIp}
                  onChange={(e) => {
                    setTargetIp(e.target.value);
                    setNodeSearchQuery(e.target.value);
                  }}
                  placeholder="เช่น 10.6.0.240 หรือ 10.5.140.111"
                  className="w-full rounded-lg bg-background border border-border px-3 py-2 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary/40 focus:outline-none"
                />
              </div>

              <div className="flex flex-col justify-end">
                <label className="inline-flex items-center gap-2 text-xs text-foreground mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoReverse}
                    onChange={(e) => setAutoReverse(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span>ยิงสลับขากลับอัตโนมัติ (Bidirectional)</span>
                </label>
                <button
                  onClick={handleRunLiveTraceroute}
                  disabled={loadingAnalyze}
                  className="w-full px-4 py-2.5 rounded-lg text-xs font-semibold text-primary-foreground shadow-sm transition disabled:opacity-50 bg-primary hover:bg-primary/90 flex items-center justify-center gap-2"
                >
                  <Zap className={`w-3.5 h-3.5 ${loadingAnalyze ? 'animate-spin' : ''}`} />
                  <span>{loadingAnalyze ? 'กำลังประมวลผลการยิง...' : 'Run Live MPLS OAM Traceroute'}</span>
                </button>
              </div>
            </div>

            <datalist id="wan2lo0-nodes-datalist">
              {nodeOptions.map((n) => (
                <option key={n.ip_nms} value={n.ip_nms}>
                  {n.hostname} ({n.model || 'Router'}) - {n.area}
                </option>
              ))}
            </datalist>

            {(forwardTraceRaw || returnTraceRaw) && (
              <div className="border-t border-border pt-3">
                <button
                  onClick={() => setShowRawCli(!showRawCli)}
                  className="text-xs font-semibold text-sky-400 hover:underline"
                >
                  {showRawCli ? '▼ ซ่อนผลลัพธ์ Raw CLI Traceroute' : '▶ แสดงผลลัพธ์ Raw CLI Traceroute'}
                </button>
                {showRawCli && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                    {forwardTraceRaw && (
                      <div className="bg-muted/50 border border-border rounded-xl p-3">
                        <div className="text-[11px] font-bold text-sky-400 mb-1">
                          Forward CLI ({forwardTraceRaw.source_router} ➔ {forwardTraceRaw.target_ip}) [
                          {forwardTraceRaw.elapsed_seconds}s]
                        </div>
                        <pre className="text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap max-h-48">
                          {forwardTraceRaw.raw_output || forwardTraceRaw.error || 'No output'}
                        </pre>
                      </div>
                    )}
                    {returnTraceRaw && (
                      <div className="bg-muted/50 border border-border rounded-xl p-3">
                        <div className="text-[11px] font-bold text-orange-400 mb-1">
                          Return CLI ({returnTraceRaw.source_router} ➔ {returnTraceRaw.target_ip}) [
                          {returnTraceRaw.elapsed_seconds}s]
                        </div>
                        <pre className="text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap max-h-48">
                          {returnTraceRaw.raw_output || returnTraceRaw.error || 'No output'}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {segmentedTraceRaw && (
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between bg-purple-500/10 border border-purple-500/30 rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🌐</span>
                    <div>
                      <div className="text-xs font-bold text-purple-400">
                        Segmented MPLS OAM Tracing (BGP-LU Cross-Domain)
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {segmentedTraceRaw.source_hostname} ({segmentedTraceRaw.source_router}) ➔ {segmentedTraceRaw.target_hostname} ({segmentedTraceRaw.target_ip})
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                      Domains: {segmentedTraceRaw.total_domains}
                    </span>
                    <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                      Stitched Hops: {segmentedTraceRaw.stitched_hops.length}
                    </span>
                    <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      ⏱️ {segmentedTraceRaw.total_elapsed_seconds}s
                    </span>
                  </div>
                </div>

                {/* Segments breakdown */}
                <div className="space-y-2">
                  {segmentedTraceRaw.segments.map((seg) => (
                    <div key={seg.domain_index} className="bg-muted/30 border border-border rounded-xl p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-600 text-white">
                            Domain {seg.domain_index}
                          </span>
                          <span className="font-bold text-foreground">{seg.domain_name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border font-mono">
                            {seg.driver_os.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          BGP Next-Hop: <span className="text-sky-400 font-semibold">{seg.nexthop || 'N/A'}</span>
                          {seg.bgp_label && (
                            <> | BGP Label: <span className="text-amber-400 font-semibold">{seg.bgp_label}</span></>
                          )}
                          {seg.local_label && (
                            <> | Local Label: <span className="text-emerald-400 font-semibold">{seg.local_label}</span></>
                          )}
                          {' '}• ⏱️ {seg.elapsed_seconds}s
                        </div>
                      </div>

                      {/* Hops Table */}
                      {seg.hops.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[11px]">
                            <thead>
                              <tr className="border-b border-border/50 text-muted-foreground">
                                <th className="py-1 px-2 w-12">Hop</th>
                                <th className="py-1 px-2">Hop IP</th>
                                <th className="py-1 px-2">Status / Code</th>
                                <th className="py-1 px-2">MPLS Label Stack</th>
                                <th className="py-1 px-2 text-right">RTT</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20 font-mono">
                              {seg.hops.map((h, hidx) => {
                                const isBorder = (hidx === seg.hops.length - 1 && !seg.is_final_segment);
                                return (
                                  <tr key={hidx} className={isBorder ? 'bg-amber-500/10' : ''}>
                                    <td className="py-1 px-2 text-muted-foreground">{h.hop}</td>
                                    <td className="py-1 px-2 text-foreground font-semibold flex items-center gap-1.5">
                                      {h.ip}
                                      {isBorder && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                          ABR BORDER
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1 px-2">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                        h.status === 'success' || h.code === '!'
                                          ? 'bg-emerald-500/20 text-emerald-400'
                                          : h.status === 'labeled' || h.code === 'L'
                                          ? 'bg-sky-500/20 text-sky-400'
                                          : 'bg-amber-500/20 text-amber-400'
                                      }`}>
                                        {h.code || '!'} ({h.status})
                                      </span>
                                    </td>
                                    <td className="py-1 px-2">
                                      {h.labels.length > 0 ? (
                                        <div className="flex flex-wrap gap-1">
                                          {h.labels.map((lbl, li) => (
                                            <span key={li} className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
                                              {li === 0 ? 'Transport: ' : 'VPN/BGP: '}{lbl}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </td>
                                    <td className="py-1 px-2 text-right text-muted-foreground">
                                      {h.rtt_ms !== null && h.rtt_ms !== undefined ? `${h.rtt_ms} ms` : '-'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {seg.raw_trace && (
                        <details className="text-[10px] text-muted-foreground">
                          <summary className="cursor-pointer hover:text-foreground">
                            Raw CLI Output ({seg.trace_command})
                          </summary>
                          <pre className="mt-1 p-2 rounded bg-muted/50 border border-border text-foreground font-mono whitespace-pre-wrap overflow-x-auto max-h-36">
                            {seg.raw_trace}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mode 3: Single Box General Mode */}
        {inputTab === 'general' && (
          <div className="space-y-3">
            <textarea
              rows={6}
              value={genText}
              onChange={(e) => setGenText(e.target.value)}
              placeholder="วางรายการ IP WAN หรือผล Traceroute (รองรับแท็ก #FORWARD และ #RETURN)..."
              className="w-full rounded-xl bg-background border border-border p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setGenText('')}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition"
              >
                ล้างข้อมูล
              </button>
              <button
                onClick={() => handleAnalyze('general')}
                disabled={loadingAnalyze}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition flex items-center gap-2 disabled:opacity-50"
              >
                <Search className={`w-3.5 h-3.5 ${loadingAnalyze ? 'animate-spin' : ''}`} />
                <span>{loadingAnalyze ? 'กำลังวิเคราะห์...' : 'วิเคราะห์ข้อมูล'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-300 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Loading Analysis State */}
      {loadingAnalyze && (
        <div className="bg-card border border-border/80 rounded-2xl p-12 text-center shadow-sm space-y-3">
          <div className="w-10 h-10 mx-auto rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-xs font-semibold text-foreground">
            กำลังวิเคราะห์ IP WAN และสร้างแผนภาพ Topology...
          </p>
        </div>
      )}

      {/* Empty State when no analysis has been run */}
      {!analysis && !loadingAnalyze && (
        <div className="bg-card border border-border/80 rounded-2xl p-12 text-center shadow-sm space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Network className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-base font-bold text-foreground">
              พร้อมวิเคราะห์เส้นทาง Network Topology
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              กรอกข้อมูลผลลัพธ์ Traceroute ในช่องด้านบน หรือเลือกแท็บ{' '}
              <span className="text-primary font-medium">"สั่งยิง Live Traceroute จริงใน Network"</span>{' '}
              เพื่อทดสอบเส้นทางสดจากเราเตอร์ต้นทาง แล้วกดปุ่ม{' '}
              <span className="font-semibold text-foreground">"วิเคราะห์เส้นทางและสร้าง Topology"</span>
            </p>
          </div>
        </div>
      )}

      {/* Results Area */}
      {analysis && (
        <>
          {/* 6 Main KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Input IPs */}
            <div className="p-4 rounded-2xl bg-card border border-border hover:border-sky-500/40 transition-all shadow-sm relative overflow-hidden group">
              <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">IP ป้อนเข้า</span>
                <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <ListFilter className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
                {analysis.stats.input_ips_count}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                Forward + Return
              </p>
            </div>

            {/* Matched Interfaces */}
            <div className="p-4 rounded-2xl bg-card border border-border hover:border-cyan-500/40 transition-all shadow-sm relative overflow-hidden group">
              <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">พอร์ตที่พบ</span>
                <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Network className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-bold font-mono text-cyan-400 tracking-tight">
                {analysis.stats.matched_interfaces_count}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                + Auto Peer /30 /31
              </p>
            </div>

            {/* Routers Count */}
            <div className="p-4 rounded-2xl bg-card border border-border hover:border-emerald-500/40 transition-all shadow-sm relative overflow-hidden group">
              <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">จำนวน Router</span>
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Server className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-400 tracking-tight">
                {analysis.stats.routers_count}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Loopback0 Nodes
              </p>
            </div>

            {/* Links Count */}
            <div className="p-4 rounded-2xl bg-card border border-border hover:border-indigo-500/40 transition-all shadow-sm relative overflow-hidden group">
              <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">Link เชื่อมโยง</span>
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <Share2 className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-bold font-mono text-indigo-400 tracking-tight">
                {analysis.stats.links_count}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                คู่สายใน Topology
              </p>
            </div>

            {/* Active Incidents */}
            <div className="p-4 rounded-2xl bg-card border border-border hover:border-rose-500/40 transition-all shadow-sm relative overflow-hidden group">
              <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-rose-500">Active Incidents</span>
                <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20">
                  <AlertTriangle className="w-3.5 h-3.5" />
                </div>
              </div>
              <div
                className={`text-2xl font-bold font-mono tracking-tight ${
                  analysis.stats.active_incidents_count > 0 ? 'text-rose-500 animate-pulse' : 'text-emerald-400'
                }`}
              >
                {analysis.stats.active_incidents_count}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    analysis.stats.active_incidents_count > 0 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-400'
                  }`}
                />
                บนเส้นทางสายนี้
              </p>
            </div>

            {/* Execution Time */}
            <div className="p-4 rounded-2xl bg-card border border-border hover:border-amber-500/40 transition-all shadow-sm relative overflow-hidden group">
              <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">เวลาประมวลผล</span>
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Clock className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
                {analysis.exec_time}s
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Seconds to resolve
              </p>
            </div>
          </div>

          {/* Interactive Topology Diagram Card */}
          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Network className="w-4 h-4 text-primary" />
                  <span>แผนผังการเชื่อมต่อ (Interactive Network Topology)</span>
                </h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                  เส้นทึบ = ขาไป (Forward)
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 border border-dashed" />
                  เส้นประ = ขากลับ (Return)
                </span>
                {inspection && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>แสดงสีสถานะพอร์ตบนเส้นแล้ว</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => {
                    if (!diagramContainerRef.current) return;
                    const r = diagramContainerRef.current.getBoundingClientRect();
                    zoomAtPoint(scaleRef.current - 0.2, r.left + r.width / 2, r.top + r.height / 2);
                  }}
                  className="p-2 rounded-lg text-xs bg-muted hover:bg-muted/80 text-foreground transition"
                  title="ซูมออก"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 py-1 text-xs font-mono text-muted-foreground">
                  {zoomPercent}%
                </span>
                <button
                  onClick={() => {
                    if (!diagramContainerRef.current) return;
                    const r = diagramContainerRef.current.getBoundingClientRect();
                    zoomAtPoint(scaleRef.current + 0.2, r.left + r.width / 2, r.top + r.height / 2);
                  }}
                  className="p-2 rounded-lg text-xs bg-muted hover:bg-muted/80 text-foreground transition"
                  title="ซูมเข้า"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={fitDiagramToScreen}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition flex items-center gap-1"
                >
                  <Scan className="w-3.5 h-3.5" />
                  <span>พอดีจอ (Fit)</span>
                </button>
                <button
                  onClick={handleResetNodePositions}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>รีเซ็ตตำแหน่ง</span>
                </button>
                <button
                  onClick={() => setShowMermaidCodeModal(!showMermaidCodeModal)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition flex items-center gap-1"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Mermaid</span>
                </button>
                <button
                  onClick={handleDownloadJPG}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground transition flex items-center gap-1.5 shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>ดาวน์โหลด JPG (2x)</span>
                </button>
                <button
                  onClick={() => {
                    setIsFullscreen(!isFullscreen);
                    setTimeout(fitDiagramToScreen, 60);
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition flex items-center gap-1"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>{isFullscreen ? 'ออกเต็มจอ' : 'เต็มจอ'}</span>
                </button>
              </div>
            </div>

            {showMermaidCodeModal && (
              <div className="bg-muted/50 border border-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-sky-400">Mermaid Flowchart Syntax</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(analysis.mermaid_code);
                      showToast('คัดลอกโค้ด Mermaid แล้ว');
                    }}
                    className="text-xs text-emerald-400 hover:underline"
                  >
                    คัดลอกโค้ด
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-foreground overflow-x-auto max-h-44">
                  {analysis.mermaid_code}
                </pre>
              </div>
            )}

            {/* Diagram Canvas */}
            <div
              ref={diagramContainerRef}
              onWheel={(e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.12 : 0.89;
                zoomAtPoint(scaleRef.current * factor, e.clientX, e.clientY);
              }}
              onMouseDown={(e) => {
                if (e.button !== 0 && e.button !== 1) return;
                if (activeDragNodeRef.current || activeDragLabelRef.current) return;
                isPanningRef.current = true;
                panStartXRef.current = e.clientX - panXRef.current;
                panStartYRef.current = e.clientY - panYRef.current;
              }}
              style={{
                backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
              className={`bg-card border border-border rounded-xl overflow-hidden relative select-none cursor-grab active:cursor-grabbing ${
                isFullscreen
                  ? 'fixed inset-0 z-50 w-screen h-screen rounded-none'
                  : 'h-[540px]'
              }`}
            >
              {isFullscreen && (
                <div className="absolute top-4 right-4 z-50 flex gap-2">
                  <button
                    onClick={fitDiagramToScreen}
                    className="px-3 py-1.5 rounded-lg bg-card text-foreground border border-border text-xs font-semibold shadow"
                  >
                    Fit to Screen
                  </button>
                  <button
                    onClick={() => setIsFullscreen(false)}
                    className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold shadow"
                  >
                    ✕ ปิดโหมดเต็มจอ
                  </button>
                </div>
              )}
              <div ref={diagramViewportRef} className="w-full h-full">
                <div ref={mermaidGraphRef} className="w-full h-full" />
              </div>
              <div className="absolute bottom-2.5 left-3 bg-muted/80 backdrop-blur text-foreground border border-border px-3 py-1 rounded-full text-[11px] pointer-events-none flex items-center gap-1.5 shadow-sm">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>ลากที่ตัวโหนด Router หรือป้ายชื่อสายเพื่อจัดตำแหน่งอิสระ • หมุนลูกกลิ้งเมาส์เพื่อซูม</span>
              </div>
            </div>
          </div>

          {/* ==================================================================== */}
          {/* Per-Router / Per-Interface Traffic Loss Diagnostic Section           */}
          {/* ==================================================================== */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  <span>ตรวจสอบสุขภาพพอร์ตและปัญหา Traffic Loss ตาม Topology (Per-Interface Diagnostics)</span>
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ตรวจสอบครบทั้งขาออก (Egress) และขาเข้า (Ingress) ของแต่ละ Hop ใน Topology:
                  CRC / Physical Errors, Queue Drops, Real-Time Δ (15 วินาที), % Load, ค่าแสง DOM (Rx/Tx dBm), และขนาด MTU
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={measureDelta}
                    onChange={(e) => setMeasureDelta(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span>วัดอัตราเพิ่มขึ้นแบบ Real-Time (Δ 15 วินาที)</span>
                </label>
                <button
                  onClick={handleInspectInterfaces}
                  disabled={loadingInspect || !analysis.topology_interfaces.length}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Activity className={`w-3.5 h-3.5 ${loadingInspect ? 'animate-spin' : ''}`} />
                  <span>
                    {loadingInspect
                      ? 'กำลังดึงค่าจาก Router ทุกตัวในเส้นทาง (Δ 15s)...'
                      : `ตรวจสอบทุกพอร์ตในเส้นทาง (${analysis.topology_interfaces.length} พอร์ต)`}
                  </span>
                </button>
              </div>
            </div>

            {inspection && (
              <div className="space-y-4">
                {/* Summary Badges */}
                <div className="flex flex-wrap items-center gap-2.5 bg-muted/40 p-3 rounded-xl border border-border">
                  <span className="text-xs font-semibold text-foreground">
                    ผลการตรวจ ({inspection.elapsed_seconds}s):
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>ปกติ (HEALTHY): {inspection.summary.healthy_count}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>เฝ้าระวัง (WARNING): {inspection.summary.warning_count}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                    <XCircle className="w-3.5 h-3.5 text-rose-500" />
                    <span>ผิดปกติ/ดรอป (CRITICAL): {inspection.summary.critical_count}</span>
                  </span>
                  {inspection.summary.unreachable_count > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-muted text-muted-foreground border border-border">
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>เข้าไม่ถึง: {inspection.summary.unreachable_count}</span>
                    </span>
                  )}
                  {inspection.summary.total_bundles !== undefined && inspection.summary.total_bundles > 0 && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                        (inspection.summary.degraded_bundles || 0) > 0
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          : 'bg-primary/10 text-primary border-primary/20'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>
                        LAG Bundles: {inspection.summary.total_bundles} พอร์ต
                        {inspection.summary.degraded_bundles && inspection.summary.degraded_bundles > 0
                          ? ` (จุลดลง/ลิงก์ขาด: ${inspection.summary.degraded_bundles})`
                          : ' (สมาชิกสมบูรณ์)'}
                      </span>
                    </span>
                  )}
                  {inspection.summary.min_mtu && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                        inspection.summary.mtu_consistent
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}
                    >
                      {inspection.summary.mtu_consistent
                        ? `MTU สอดคล้องกันทั้งเส้นทาง (${inspection.summary.min_mtu} Bytes)`
                        : `MTU ไม่เท่ากัน: ต่ำสุด ${inspection.summary.min_mtu}B / สูงสุด ${inspection.summary.max_mtu}B`}
                    </span>
                  )}
                </div>

                {/* Per-Interface Inspection Table */}
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/70 text-[11px] uppercase text-muted-foreground border-b border-border">
                        <th className="px-3 py-2.5">Hop / บทบาท</th>
                        <th className="px-3 py-2.5">Router (Loopback0)</th>
                        <th className="px-3 py-2.5">Interface / WAN IP</th>
                        <th className="px-3 py-2.5">สถานะ / MTU</th>
                        <th className="px-3 py-2.5">Traffic &amp; % Load</th>
                        <th className="px-3 py-2.5">Physical Errors (CRC / In / Out)</th>
                        <th className="px-3 py-2.5">Queue Drops (In / Out)</th>
                        <th className="px-3 py-2.5">ค่าแสง DOM (Rx / Tx) &amp; Flaps</th>
                        <th className="px-3 py-2.5">การวินิจฉัย Traffic Loss</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60 text-xs">
                      {inspection.results.map((item, idx) => {
                        const rowKey = `${item.ip_loopback}-${item.interface}-${idx}`;
                        const isExpanded =
                          expandedBundles[rowKey] !== undefined
                            ? expandedBundles[rowKey]
                            : Boolean(item.bundle_summary?.degraded);

                        return (
                          <React.Fragment key={rowKey}>
                            <tr className="hover:bg-muted/30 transition-colors">
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    item.direction === 'return'
                                      ? 'bg-orange-500/15 text-orange-400'
                                      : 'bg-sky-500/15 text-sky-400'
                                  }`}
                                >
                                  Link #{item.link_index + 1} ({item.direction})
                                </span>
                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                  {item.role}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <div className="font-bold text-foreground">{item.hostname}</div>
                                <div className="font-mono text-[11px] text-emerald-400">
                                  {item.ip_loopback}{' '}
                                  {item.model && (
                                    <span className="text-muted-foreground font-sans">
                                      ({item.model})
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                                {item.is_bundle ? (
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => toggleBundleExpand(rowKey)}
                                        className="inline-flex items-center gap-1 text-left font-semibold text-foreground hover:text-primary transition-colors group"
                                        title={
                                          isExpanded
                                            ? 'ย่อรายละเอียดสมาชิกลิงก์'
                                            : 'คลิกดูรายละเอียดสมาชิกลิงก์ (LAG Members)'
                                        }
                                      >
                                        {isExpanded ? (
                                          <ChevronDown className="w-3.5 h-3.5 text-primary group-hover:scale-110 transition-transform" />
                                        ) : (
                                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:scale-110 transition-transform" />
                                        )}
                                        <span>{item.interface}</span>
                                      </button>
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/20">
                                        LAG Bundle
                                      </span>
                                    </div>
                                    {item.bundle_summary && (
                                      <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                                        <span
                                          className={`px-1.5 py-0.5 rounded font-semibold ${
                                            item.bundle_summary.degraded
                                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                          }`}
                                        >
                                          {item.bundle_summary.active_links}/{item.bundle_summary.total_links} Links Active
                                        </span>
                                        {item.bundle_summary.capacity_loss_pct > 0 && (
                                          <span className="text-rose-400 font-bold">
                                            (-{item.bundle_summary.capacity_loss_pct}%)
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="font-semibold text-foreground">{item.interface}</div>
                                )}
                                <div className="text-[11px] text-sky-400 mt-0.5">{item.ip_address}</div>
                                {item.circuit && (
                                  <span className="text-[10px] text-amber-300 block">{item.circuit}</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    item.oper_status === 'up'
                                      ? 'bg-emerald-500/15 text-emerald-400'
                                      : item.oper_status === 'down'
                                      ? 'bg-red-500/20 text-red-400'
                                      : 'bg-slate-500/20 text-slate-400'
                                  }`}
                                >
                                  {item.oper_status}
                                </span>
                                <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                                  MTU: {item.mtu_bytes ? `${item.mtu_bytes}B` : '-'}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap font-mono">
                                <div>
                                  Rx: {item.rx_mbps} Mbps ({item.rx_load_pct}%)
                                </div>
                                <div>
                                  Tx: {item.tx_mbps} Mbps ({item.tx_load_pct}%)
                                </div>
                                <div className="w-28 h-1.5 bg-slate-700 rounded-full overflow-hidden mt-1">
                                  <div
                                    className={`h-full ${
                                      Math.max(item.rx_load_pct, item.tx_load_pct) >= 90
                                        ? 'bg-red-500'
                                        : Math.max(item.rx_load_pct, item.tx_load_pct) >= 75
                                        ? 'bg-amber-400'
                                        : 'bg-emerald-400'
                                    }`}
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        Math.max(item.rx_load_pct, item.tx_load_pct)
                                      )}%`,
                                    }}
                                  />
                                </div>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap font-mono">
                                <div>
                                  CRC: <b className={item.crc_errors > 0 ? 'text-amber-300' : ''}>{item.crc_errors}</b>{' '}
                                  {item.delta_crc > 0 && (
                                    <span className="px-1.5 py-0.2 rounded bg-red-500/20 text-red-400 font-bold">
                                      +{item.delta_crc}/15s
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  InErr: {item.in_errors}{' '}
                                  {item.delta_in_errors > 0 && (
                                    <span className="text-red-400 font-bold">
                                      (+{item.delta_in_errors})
                                    </span>
                                  )}{' '}
                                  | OutErr: {item.out_errors}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap font-mono">
                                <div>
                                  OutDrop:{' '}
                                  <b className={item.out_drops > 0 ? 'text-amber-300' : ''}>
                                    {item.out_drops}
                                  </b>{' '}
                                  {item.delta_out_drops > 0 && (
                                    <span className="px-1.5 py-0.2 rounded bg-red-500/20 text-red-400 font-bold">
                                      +{item.delta_out_drops}/15s
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  InDrop: {item.in_drops}{' '}
                                  {item.delta_in_drops > 0 && (
                                    <span className="text-red-400 font-bold">
                                      (+{item.delta_in_drops})
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap font-mono">
                                <div>
                                  Rx:{' '}
                                  {item.rx_power_dbm !== null && item.rx_power_dbm !== undefined
                                    ? `${item.rx_power_dbm} dBm`
                                    : '-'}
                                  {item.is_bundle && item.members && item.members.length > 0 && (
                                    <span className="text-[10px] text-muted-foreground ml-1 font-sans">
                                      (สมาชิก {item.members.length})
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  Tx:{' '}
                                  {item.tx_power_dbm !== null && item.tx_power_dbm !== undefined
                                    ? `${item.tx_power_dbm} dBm`
                                    : '-'}{' '}
                                  | Flaps: {item.carrier_transitions}
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="mb-1">{renderHealthBadge(item)}</div>
                                {item.issues && item.issues.length > 0 ? (
                                  <ul className="text-[11px] text-amber-200 list-disc pl-4 space-y-0.5">
                                    {item.issues.map((iss, i) => (
                                      <li key={i}>{iss}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="text-[11px] text-emerald-400">
                                    ไม่พบ Error หรือ Packet Drop เพิ่มขึ้น (Δ=0)
                                  </span>
                                )}
                              </td>
                            </tr>

                            {/* LAG Bundle Member Links Sub-Table Accordion */}
                            {item.is_bundle && isExpanded && (
                              <tr className="bg-muted/15 border-b border-border/80">
                                <td colSpan={9} className="p-3 pl-6 sm:pl-10">
                                  <div className="bg-card/90 rounded-xl p-3.5 border border-border/80 space-y-3 shadow-sm">
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <div className="flex items-center gap-2 font-semibold text-foreground">
                                        <Layers className="w-4 h-4 text-primary" />
                                        <span>
                                          รายละเอียดสมาชิกลิงก์ (Member Links) ของ {item.interface}
                                          {item.bundle_summary?.bundle_type ? ` [${item.bundle_summary.bundle_type}]` : ''}
                                        </span>
                                        {item.bundle_summary && (
                                          <span className="text-[11px] text-muted-foreground font-normal">
                                            (ความเร็วรวม {item.bundle_summary.bundle_bw_mbps >= 1000 ? `${(item.bundle_summary.bundle_bw_mbps / 1000).toFixed(0)} Gbps` : `${item.bundle_summary.bundle_bw_mbps} Mbps`} • กำลังทำงาน {item.bundle_summary.active_links}/{item.bundle_summary.total_links} พอร์ต)
                                          </span>
                                        )}
                                      </div>
                                      {item.bundle_summary?.degraded ? (
                                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                          ⚠️ แบนด์วิดท์ลดลง {item.bundle_summary.capacity_loss_pct}% (มีสมาชิกลิงก์ขัดข้อง)
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                                          ✓ สมาชิกลิงก์ทำงานครบสมบูรณ์ทุกพอร์ต
                                        </span>
                                      )}
                                    </div>

                                    {item.members && item.members.length > 0 ? (
                                      <div className="overflow-x-auto rounded-lg border border-border/60">
                                        <table className="w-full text-left border-collapse text-xs">
                                          <thead>
                                            <tr className="bg-muted/70 text-[10px] uppercase text-muted-foreground border-b border-border/60">
                                              <th className="px-3 py-2">Member Interface</th>
                                              <th className="px-3 py-2">สถานะใน LAG</th>
                                              <th className="px-3 py-2">Speed</th>
                                              <th className="px-3 py-2">Traffic (Rx / Tx)</th>
                                              <th className="px-3 py-2">Physical Errors (CRC / In / Out)</th>
                                              <th className="px-3 py-2">Queue Drops (In / Out)</th>
                                              <th className="px-3 py-2">ค่าแสง DOM (Rx / Tx)</th>
                                              <th className="px-3 py-2">Flaps</th>
                                              <th className="px-3 py-2">สุขภาพสมาชิกลิงก์</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-border/40 font-mono">
                                            {item.members.map((m, mIdx) => (
                                              <tr
                                                key={`${m.interface}-${mIdx}`}
                                                className={`hover:bg-muted/40 transition-colors ${
                                                  m.health_level === 'CRITICAL'
                                                    ? 'bg-rose-500/5'
                                                    : m.health_level === 'WARNING'
                                                    ? 'bg-amber-500/5'
                                                    : ''
                                                }`}
                                              >
                                                <td className="px-3 py-2 font-bold text-foreground">
                                                  {m.interface}
                                                </td>
                                                <td className="px-3 py-2">
                                                  <span
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                      m.bundle_status === 'Active' || m.bundle_status === 'Up'
                                                        ? 'bg-emerald-500/15 text-emerald-400'
                                                        : 'bg-rose-500/20 text-rose-400'
                                                    }`}
                                                  >
                                                    {m.bundle_status}
                                                  </span>
                                                </td>
                                                <td className="px-3 py-2 text-muted-foreground">
                                                  {m.speed_mbps ? `${(m.speed_mbps / 1000).toFixed(0)} Gbps` : '-'}
                                                </td>
                                                <td className="px-3 py-2">
                                                  <div>Rx: {m.rx_mbps} Mbps ({m.rx_load_pct}%)</div>
                                                  <div>Tx: {m.tx_mbps} Mbps ({m.tx_load_pct}%)</div>
                                                </td>
                                                <td className="px-3 py-2">
                                                  <div>
                                                    CRC: <b className={m.crc_errors > 0 ? 'text-amber-300' : ''}>{m.crc_errors}</b>{' '}
                                                    {m.delta_crc > 0 && (
                                                      <span className="px-1.5 py-0.2 rounded bg-red-500/20 text-red-400 font-bold">
                                                        +{m.delta_crc}/15s
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div className="text-[10px] text-muted-foreground">
                                                    InErr: {m.in_errors}{' '}
                                                    {m.delta_in_errors > 0 && (
                                                      <span className="text-red-400 font-bold">(+{m.delta_in_errors})</span>
                                                    )}{' '}
                                                    | OutErr: {m.out_errors}
                                                  </div>
                                                </td>
                                                <td className="px-3 py-2">
                                                  <div>
                                                    OutDrop:{' '}
                                                    <b className={m.out_drops > 0 ? 'text-amber-300' : ''}>{m.out_drops}</b>{' '}
                                                    {m.delta_out_drops > 0 && (
                                                      <span className="px-1.5 py-0.2 rounded bg-red-500/20 text-red-400 font-bold">
                                                        +{m.delta_out_drops}/15s
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div className="text-[10px] text-muted-foreground">
                                                    InDrop: {m.in_drops}{' '}
                                                    {m.delta_in_drops > 0 && (
                                                      <span className="text-red-400 font-bold">(+{m.delta_in_drops})</span>
                                                    )}
                                                  </div>
                                                </td>
                                                <td className="px-3 py-2">
                                                  <div>
                                                    Rx:{' '}
                                                    {m.rx_power_dbm !== null && m.rx_power_dbm !== undefined ? (
                                                      <span
                                                        className={
                                                          m.rx_power_dbm <= -20.0
                                                            ? 'text-rose-400 font-bold'
                                                            : m.rx_power_dbm <= -15.0
                                                            ? 'text-amber-300 font-semibold'
                                                            : 'text-emerald-400'
                                                        }
                                                      >
                                                        {m.rx_power_dbm} dBm
                                                      </span>
                                                    ) : (
                                                      '-'
                                                    )}
                                                  </div>
                                                  <div className="text-[10px] text-muted-foreground">
                                                    Tx:{' '}
                                                    {m.tx_power_dbm !== null && m.tx_power_dbm !== undefined
                                                      ? `${m.tx_power_dbm} dBm`
                                                      : '-'}
                                                  </div>
                                                </td>
                                                <td className="px-3 py-2 text-muted-foreground">
                                                  {m.carrier_transitions}
                                                </td>
                                                <td className="px-3 py-2 font-sans">
                                                  <span
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                      m.health_level === 'CRITICAL'
                                                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                                        : m.health_level === 'WARNING'
                                                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                    }`}
                                                  >
                                                    {m.health_level}
                                                  </span>
                                                  {m.issues && m.issues.length > 0 && (
                                                    <div className="text-[10px] text-amber-300 mt-1 space-y-0.5">
                                                      {m.issues.map((iss, i) => (
                                                        <div key={i}>• {iss}</div>
                                                      ))}
                                                    </div>
                                                  )}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-muted-foreground italic py-1">
                                        ไม่พบข้อมูลสมาชิกลิงก์ที่ผูกอยู่ หรือ Router ยังไม่ได้รายงานสมาชิกที่ Up
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ==================================================================== */}
          {/* Forward & Return Hop Mapping Tables                                  */}
          {/* ==================================================================== */}
          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span>ตารางรายละเอียด Hop &amp; Interface Mapping</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                  placeholder="ค้นหา IP, Hostname, Interface..."
                  className="rounded-lg bg-background border border-border px-2.5 py-1 text-xs text-foreground w-60 focus:ring-1 focus:ring-primary/40 focus:outline-none"
                />
                <button
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary hover:bg-secondary/80 text-foreground border border-border transition flex items-center gap-1.5 shadow-sm"
                >
                  <Download className="w-3.5 h-3.5 text-primary" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {analysis.mode === 'asymmetric' ? (
              <div className="space-y-3">
                {/* Forward Table */}
                <div className="border border-sky-500/30 rounded-xl overflow-hidden">
                  <div className="bg-sky-500/10 px-3 py-1.5 border-b border-sky-500/30 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-sky-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-sky-500" />
                      <span>เส้นทางขาไป (Forward Path)</span>
                    </span>
                    <span className="text-[11px] text-sky-400">
                      {analysis.records_fwd.length} รายการ
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-muted/50 text-[10px] text-muted-foreground border-b border-border">
                          <th className="px-2 py-1.5">ลำดับ / RTT</th>
                          <th className="px-2 py-1.5">IP WAN (Subnet)</th>
                          <th className="px-2 py-1.5">Interface</th>
                          <th className="px-2 py-1.5">Hostname</th>
                          <th className="px-2 py-1.5">Loopback0 / รุ่น / พื้นที่</th>
                          <th className="px-2 py-1.5">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filterRecords(analysis.records_fwd).map((r, i) =>
                          renderRecordRow(r, i)
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Return Table */}
                <div className="border border-orange-500/30 rounded-xl overflow-hidden">
                  <div className="bg-orange-500/10 px-3 py-1.5 border-b border-orange-500/30 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-orange-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-orange-400" />
                      <span>เส้นทางขากลับ (Return Path)</span>
                    </span>
                    <span className="text-[11px] text-orange-400">
                      {analysis.records_ret.length} รายการ
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-muted/50 text-[10px] text-muted-foreground border-b border-border">
                          <th className="px-2 py-1.5">ลำดับ / RTT</th>
                          <th className="px-2 py-1.5">IP WAN (Subnet)</th>
                          <th className="px-2 py-1.5">Interface</th>
                          <th className="px-2 py-1.5">Hostname</th>
                          <th className="px-2 py-1.5">Loopback0 / รุ่น / พื้นที่</th>
                          <th className="px-2 py-1.5">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filterRecords(analysis.records_ret).map((r, i) =>
                          renderRecordRow(r, i)
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/50 text-[10px] text-muted-foreground border-b border-border">
                        <th className="px-2 py-1.5">ลำดับ / RTT</th>
                        <th className="px-2 py-1.5">IP WAN (Subnet)</th>
                        <th className="px-2 py-1.5">Interface</th>
                        <th className="px-2 py-1.5">Hostname</th>
                        <th className="px-2 py-1.5">Loopback0 / รุ่น / พื้นที่</th>
                        <th className="px-2 py-1.5">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filterRecords(analysis.records_all).map((r, i) =>
                        renderRecordRow(r, i)
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {analysis.not_found_ips.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300">
                <b>⚠️ IP ที่ไม่พบในฐานข้อมูล ipwan ({analysis.not_found_ips.length}):</b>{' '}
                <span className="font-mono">{analysis.not_found_ips.join(', ')}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
