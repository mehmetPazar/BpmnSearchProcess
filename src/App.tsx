import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { XMLParser } from 'fast-xml-parser';
import BpmnViewer from 'bpmn-js';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';

interface MatchedElement {
  elementId: string;
  elementType: 'callActivity' | 'scriptTask' | 'script' | 'conditionExpression';
  matchingElement: string;
  matchedText?: string;
}

interface ProcessReference {
  fileName: string;
  xmlContent: string;
  matchingElement: string;
  elementId?: string;
  processName?: string;
  previewRef?: React.RefObject<HTMLDivElement>;
  elementType?: 'callActivity' | 'scriptTask' | 'script' | 'conditionExpression';
  matchedText?: string;
  parentElementName?: string;
  matchedElements?: MatchedElement[];
}

interface BpmnElement {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  waypoints?: Array<{ x: number; y: number }>;
  businessObject?: {
    bounds?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    sourceRef?: {
      id: string;
    };
    targetRef?: {
      id: string;
    };
  };
}

interface BpmnViewerInstance extends BpmnViewer {
  get(name: 'canvas'): {
    zoom(scale: number | string, center?: { x: number; y: number } | { id: string }): void;
    addMarker(elementId: string, marker: string): void;
    viewbox(viewbox?: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number; scale: number };
    centerElement(element: { id: string; x?: number; y?: number }): void;
  };
  get(name: 'elementRegistry'): {
    get(elementId: string): BpmnElement | undefined;
  };
}

interface XmlObject {
  [key: string]: XmlObject | XmlObject[] | string | undefined;
  '@_calledElement'?: string;
  '@_id'?: string;
}

function App() {
  const [searchType, setSearchType] = useState<'processId' | 'text'>('processId');
  const [searchText, setSearchText] = useState('');
  const [searchProcessId, setSearchProcessId] = useState('');
  const [results, setResults] = useState<ProcessReference[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const resultsPerPage = 10;
  const previewViewersRef = useRef<{[key: string]: BpmnViewerInstance}>({});
  const [showInfo, setShowInfo] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Dark mode değiştiğinde localStorage'a kaydet
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', isDarkMode.toString());
  }, [isDarkMode]);

  // Sayfa yüklendiğinde dark mode tercihini kontrol et
  useEffect(() => {
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';
    setIsDarkMode(savedDarkMode);
  }, []);

  // Zoom kontrollerini yönet
  const handleZoom = (index: number, type: 'in' | 'out' | 'fit') => {
    // Global index hesapla
    const globalIndex = (currentPage - 1) * resultsPerPage + index;
    const viewer = previewViewersRef.current[globalIndex];
    if (!viewer) return;

    const canvas = viewer.get('canvas');
    const viewbox = canvas.viewbox();
    if (!viewbox) return;

    if (type === 'in') {
      canvas.zoom(viewbox.scale * 1.2);
    } else if (type === 'out') {
      canvas.zoom(viewbox.scale / 1.2);
    } else {
      canvas.zoom('fit-viewport');
    }
  };

  // Arama tipi değiştiğinde sonuçları sıfırla
  useEffect(() => {
    setResults([]);
    setHasSearched(false);
    setCurrentPage(1);
    setSearchProcessId('');
    setSearchText('');
    setFilterText('');
  }, [searchType]);

  // Sonuçları grupla
  const groupedResults = useMemo(() => {
    const groups = new Map<string, ProcessReference[]>();
    
    results.forEach(ref => {
      const key = `${ref.fileName}_${ref.processName}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(ref);
    });
    
    return Array.from(groups.values()).map(group => ({
      ...group[0],
      matchedElements: group.map(ref => ({
        elementId: ref.elementId || '',
        elementType: ref.elementType || 'script',
        matchingElement: ref.matchingElement,
        matchedText: ref.matchedText
      }))
    }));
  }, [results]);

  // Filtrelenmiş sonuçları hesapla
  const filteredResults = useMemo(() => {
    if (!filterText) return groupedResults;
    
    const searchTerm = filterText.toLowerCase().trim();
    return groupedResults.filter(ref => {
      const folderPath = ref.fileName.split('/').slice(0, -1).join('/').toLowerCase();
      const fileName = ref.fileName.split('/').pop()?.toLowerCase() || '';
      const processName = (ref.processName || '').toLowerCase();
      
      return folderPath.includes(searchTerm) || 
             fileName.includes(searchTerm) || 
             processName.includes(searchTerm);
    });
  }, [groupedResults, filterText]);

  // Her sonuç için yeni bir görselleştirici oluştur
  const initializeViewer = (result: ProcessReference, index: number) => {
    if (!result.previewRef?.current) return;

    // Önce container'ı temizle
    result.previewRef.current.innerHTML = '';

    // Eğer önceki viewer varsa temizle
    if (previewViewersRef.current[index]) {
      try {
        previewViewersRef.current[index].destroy();
      } catch (error) {
        console.error('Viewer destroy error:', error);
      }
      delete previewViewersRef.current[index];
    }

    const viewer = new BpmnViewer({
      container: result.previewRef.current,
      height: '300px',
      width: '100%'
    }) as BpmnViewerInstance;

    previewViewersRef.current[index] = viewer;

    viewer.importXML(result.xmlContent).then(() => {
      const canvas = viewer.get('canvas');
      const elementRegistry = viewer.get('elementRegistry');

      // Tüm eşleşen elementleri vurgula
      result.matchedElements?.forEach(match => {
        if (match.elementId) {
          const element = elementRegistry.get(match.elementId);
          if (element) {
            if (match.elementType === 'conditionExpression') {
              canvas.addMarker(element.id, 'highlight-flow');
            } else {
              canvas.addMarker(element.id, 'highlight');
            }
          }
        }
      });

      // Tüm vurgulanan elementleri kapsayacak şekilde görünümü ayarla
      const highlightedElements = result.matchedElements
        ?.map(match => elementRegistry.get(match.elementId || ''))
        .filter(element => element) as BpmnElement[];

      if (highlightedElements?.length) {
        // Tüm elementlerin koordinatlarını topla
        const allPoints: Array<{x: number, y: number}> = [];
        
        highlightedElements.forEach(element => {
          if (element.waypoints) {
            allPoints.push(...element.waypoints);
          } else {
            allPoints.push(
              { x: element.x || 0, y: element.y || 0 },
              { x: (element.x || 0) + (element.width || 0), y: (element.y || 0) + (element.height || 0) }
            );
          }
        });

        // Tüm noktaların min/max koordinatlarını bul
        const coords = allPoints.reduce((acc, point) => ({
          minX: Math.min(acc.minX, point.x),
          minY: Math.min(acc.minY, point.y),
          maxX: Math.max(acc.maxX, point.x),
          maxY: Math.max(acc.maxY, point.y)
        }), {
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity
        });

        const padding = 100;
        const newViewbox = {
          x: coords.minX - padding,
          y: coords.minY - padding,
          width: (coords.maxX - coords.minX) + (padding * 2),
          height: (coords.maxY - coords.minY) + (padding * 2)
        };

        // Önce tüm diagramı ekrana sığdır
        canvas.zoom('fit-viewport');
        
        // Sonra vurgulanan elementleri gösterecek şekilde yakınlaştır
        setTimeout(() => {
          canvas.viewbox(newViewbox);
        }, 50);
      }

      // Mouse ile sürükleme özelliğini etkinleştir
      let isDragging = false;
      let lastX = 0;
      let lastY = 0;

      if (!result.previewRef?.current) return;
      const container = result.previewRef.current;

      const handleMouseDown = (event: MouseEvent) => {
        isDragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
      };

      const handleMouseMove = (event: MouseEvent) => {
        if (!isDragging) return;
        
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;

        const viewbox = canvas.viewbox();
        canvas.viewbox({
          x: viewbox.x - dx / viewbox.scale,
          y: viewbox.y - dy / viewbox.scale,
          width: viewbox.width,
          height: viewbox.height
        });
      };

      const handleMouseUp = () => {
        isDragging = false;
      };

      // Event listener'ları ekle
      container.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      // CSS stil ekle
      const style = document.createElement('style');
      style.textContent = `
        .highlight-flow {
          stroke: #1976d2 !important;
          stroke-width: 2px !important;
        }
        .highlight-flow .djs-visual > :nth-child(1) {
          stroke: #1976d2 !important;
          fill: none !important;
          stroke-width: 2px !important;
        }
        .highlight-flow.djs-connection .djs-visual > path {
          stroke: #1976d2 !important;
          stroke-width: 2px !important;
          marker-end: url(#sequenceflow-end-white-blue) !important;
        }
        .highlight {
          stroke: #1976d2 !important;
          stroke-width: 2px !important;
        }
        .highlight .djs-visual > :nth-child(1) {
          stroke: #1976d2 !important;
        }
        .highlight .djs-visual text {
          fill: #000000 !important;
          stroke: none !important;
        }
        .highlight-flow .djs-visual text {
          fill: #000000 !important;
          stroke: none !important;
        }
        .bpmn-preview {
          background-color: white !important;
        }
      `;
      document.head.appendChild(style);

      return () => {
        // Event listener'ları ve stili temizle
        container.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        style.remove();
      };
    }).catch((err: Error) => {
      console.error('Preview BPMN yükleme hatası:', err);
    });
  };

  // Önizleme görselleştiricilerini yönet
  useEffect(() => {
    // Önceki görselleştiricileri temizle
    Object.values(previewViewersRef.current).forEach(viewer => {
      try {
        viewer.destroy();
      } catch (error) {
        console.error('Viewer destroy error:', error);
      }
    });
    previewViewersRef.current = {};

    // Sadece mevcut sayfadaki sonuçlar için görselleştirici oluştur
    const startIndex = (currentPage - 1) * resultsPerPage;
    const endIndex = startIndex + resultsPerPage;
    const currentResults = filteredResults.slice(startIndex, endIndex);

    // Her sonuç için yeni bir görselleştirici oluştur
    currentResults.forEach((result, index) => {
      const globalIndex = startIndex + index;
      if (result.previewRef?.current) {
        // Önce container'ı temizle
        result.previewRef.current.innerHTML = '';
        // Sonra yeni viewer oluştur
        initializeViewer(result, globalIndex);
      }
    });

    return () => {
      Object.values(previewViewersRef.current).forEach(viewer => {
        try {
          viewer.destroy();
        } catch (error) {
          console.error('Viewer cleanup error:', error);
        }
      });
    };
  }, [currentPage, filteredResults]); // filteredResults'ı dependency olarak ekle

  const analyzeBPMNFiles = useCallback(async () => {
    if (!selectedFiles) return;
    
    setIsLoading(true);
    setHasSearched(true);
    const references: ProcessReference[] = [];
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });

    try {
      for (const file of selectedFiles) {
        // Dosya yolunda "old" kelimesi varsa (case-insensitive) bu dosyayı atla
        if (file.webkitRelativePath.toLowerCase().includes('/old/')) {
          continue;
        }

        // Sadece .bpmn ve .xml dosyalarını işle
        if (!file.name.endsWith('.bpmn') && !file.name.endsWith('.xml')) {
          continue;
        }

        const content = await file.text();
        const xmlObj = parser.parse(content);
        
        // XML ağacını recursive olarak dolaşıp callActivity elementlerini bul
        const findCallActivities = (obj: XmlObject) => {
          if (!obj) return;
          
          if (typeof obj === 'object') {
            for (const key in obj) {
              if (key === 'callActivity' || key.endsWith(':callActivity')) {
                const activities = Array.isArray(obj[key]) ? obj[key] as XmlObject[] : [obj[key]] as XmlObject[];
                activities.forEach((activity) => {
                  // calledElement özelliğini kontrol et
                  const calledElement = activity['@_calledElement'];
                  const elementId = activity['@_id'];
                  if (calledElement === searchProcessId) {
                    // XML'i tekrar parse et ve process tag'ini bul
                    const xmlObj = parser.parse(content);
                    let processName = '';

                    // definitions altındaki process tag'ini bul
                    const definitions = xmlObj['definitions'] || xmlObj['bpmn:definitions'] || xmlObj['bpmn2:definitions'];
                    if (definitions) {
                      const process = definitions['process'] || definitions['bpmn:process'] || definitions['bpmn2:process'];
                      if (process) {
                        if (Array.isArray(process)) {
                          processName = process[0]['@_name'] || '';
                        } else {
                          processName = process['@_name'] || '';
                        }
                      }
                    }

            references.push({
                      fileName: file.webkitRelativePath || file.name,
              xmlContent: content,
                      matchingElement: `CallActivity - calledElement: ${calledElement}`,
                      elementId: elementId,
                      processName: processName || 'İsimsiz Süreç',
                      previewRef: React.createRef<HTMLDivElement>(),
                      matchedElements: [
                        { elementId: elementId, elementType: 'callActivity', matchingElement: `CallActivity - ${processName || 'İsimsiz Call Activity'}` }
                      ]
                    });
                  }
                });
              }
              if (typeof obj[key] === 'object') {
                findCallActivities(obj[key] as XmlObject);
              }
            }
          }
        };

        findCallActivities(xmlObj);
      }

      setResults(references);
    } catch (error) {
      console.error('Error analyzing BPMN files:', error);
      alert('Error analyzing BPMN files. Please check the console for details.');
    } finally {
      setIsLoading(false);
    }
  }, [searchProcessId, selectedFiles]);

  const analyzeTextInBPMN = useCallback(async () => {
    if (!selectedFiles) return;
    
    setIsLoading(true);
    setHasSearched(true);
    const references: ProcessReference[] = [];
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });

    try {
      for (const file of selectedFiles) {
        if (file.webkitRelativePath.toLowerCase().includes('/old/')) {
          continue;
        }

        if (!file.name.endsWith('.bpmn') && !file.name.endsWith('.xml')) {
          continue;
        }

        const content = await file.text();
        const xmlObj = parser.parse(content);
        
        // Process adını bul
        let processName = '';
        const definitions = xmlObj['definitions'] || xmlObj['bpmn:definitions'] || xmlObj['bpmn2:definitions'];
        if (definitions) {
          const process = definitions['process'] || definitions['bpmn:process'] || definitions['bpmn2:process'];
          if (process) {
            if (Array.isArray(process)) {
              processName = process[0]['@_name'] || '';
            } else {
              processName = process['@_name'] || '';
            }
          }
        }

        // XML ağacını recursive olarak dolaşıp elementleri bul
        const findElements = (obj: XmlObject) => {
          if (!obj) return;
          
          if (typeof obj === 'object') {
            for (const key in obj) {
              // Script içeren elementleri kontrol et
              if (key === 'script' || key.endsWith(':script')) {
                const scriptContent = obj[key];
                if (typeof scriptContent === 'string' && scriptContent.toLowerCase().includes(searchText.toLowerCase())) {
                  references.push({
                    fileName: file.webkitRelativePath || file.name,
                    xmlContent: content,
                    matchingElement: `Script içinde bulunan metin`,
                    elementType: 'script',
                    matchedText: scriptContent,
                    elementId: obj['@_id'] || `script_${Date.now()}`,
                    processName: processName || 'İsimsiz Süreç',
                    previewRef: React.createRef<HTMLDivElement>(),
                    matchedElements: [{
                      elementId: obj['@_id'] || `script_${Date.now()}`,
                      elementType: 'script',
                      matchingElement: `Script içinde bulunan metin`,
                      matchedText: scriptContent
                    }]
                  });
                }
              }
              
              // Script Task elementlerini kontrol et
              if (key === 'scriptTask' || key.endsWith(':scriptTask')) {
                const tasks = Array.isArray(obj[key]) ? obj[key] as XmlObject[] : [obj[key]] as XmlObject[];
                tasks.forEach((task) => {
                  const script = task['script'] || task['bpmn:script'];
                  if (typeof script === 'string' && script.toLowerCase().includes(searchText.toLowerCase())) {
                    references.push({
                      fileName: file.webkitRelativePath || file.name,
                      xmlContent: content,
                      matchingElement: `Script Task - ${task['@_name'] || 'İsimsiz Task'}`,
                      elementType: 'scriptTask',
                      matchedText: script,
                      elementId: task['@_id'] || `script_task_${Date.now()}`,
                      processName: processName || 'İsimsiz Süreç',
                      previewRef: React.createRef<HTMLDivElement>(),
                      matchedElements: [{
                        elementId: task['@_id'] || `script_task_${Date.now()}`,
                        elementType: 'scriptTask',
                        matchingElement: `Script Task - ${task['@_name'] || 'İsimsiz Task'}`,
                        matchedText: script
                      }]
                    });
                  }
                });
              }

              // Call Activity elementlerini kontrol et
              if (key === 'callActivity' || key.endsWith(':callActivity')) {
                const activities = Array.isArray(obj[key]) ? obj[key] as XmlObject[] : [obj[key]] as XmlObject[];
                activities.forEach((activity) => {
                  // Call Activity'nin kendisini kontrol et
                  const activityContent = JSON.stringify(activity);
                  if (activityContent.toLowerCase().includes(searchText.toLowerCase())) {
                    references.push({
                      fileName: file.webkitRelativePath || file.name,
                      xmlContent: content,
                      matchingElement: `Call Activity - ${activity['@_name'] || 'İsimsiz Call Activity'}`,
                      elementType: 'callActivity',
                      matchedText: activityContent,
                      elementId: activity['@_id'] || `call_activity_${Date.now()}`,
                      processName: processName || 'İsimsiz Süreç',
                      previewRef: React.createRef<HTMLDivElement>(),
                      matchedElements: [{
                        elementId: activity['@_id'] || `call_activity_${Date.now()}`,
                        elementType: 'callActivity',
                        matchingElement: `Call Activity - ${activity['@_name'] || 'İsimsiz Call Activity'}`,
                        matchedText: activityContent
                      }]
                    });
                  }

                  // Call Activity içindeki tüm tag'leri recursive olarak kontrol et
                  const searchInCallActivity = (callActivityObj: XmlObject) => {
                    if (!callActivityObj) return;
                    
                    if (typeof callActivityObj === 'object') {
                      for (const tagKey in callActivityObj) {
                        const value = callActivityObj[tagKey];
                        
                        // String değerleri kontrol et
                        if (typeof value === 'string' && value.toLowerCase().includes(searchText.toLowerCase())) {
                          references.push({
                            fileName: file.webkitRelativePath || file.name,
                            xmlContent: content,
                            matchingElement: `Call Activity (${activity['@_name'] || 'İsimsiz Call Activity'}) - ${tagKey}: ${value}`,
                            elementType: 'callActivity',
                            matchedText: value,
                            elementId: activity['@_id'] || `call_activity_tag_${Date.now()}`,
                            processName: processName || 'İsimsiz Süreç',
                            previewRef: React.createRef<HTMLDivElement>(),
                            matchedElements: [{
                              elementId: activity['@_id'] || `call_activity_tag_${Date.now()}`,
                              elementType: 'callActivity',
                              matchingElement: `Call Activity (${activity['@_name'] || 'İsimsiz Call Activity'}) - ${tagKey}: ${value}`,
                              matchedText: value
                            }]
                          });
                        }
                        
                        // Alt nesneleri kontrol et
                        if (typeof value === 'object') {
                          searchInCallActivity(value as XmlObject);
                        }
                      }
                    }
                  };

                  searchInCallActivity(activity);
                });
              }

              // Condition Expression elementlerini kontrol et
              if (key === 'conditionExpression' || key.endsWith(':conditionExpression')) {
                const expressions = Array.isArray(obj[key]) ? obj[key] as XmlObject[] : [obj[key]] as XmlObject[];
                expressions.forEach((expression) => {
                  let expressionContent = '';
                  // Expression içeriği doğrudan string olarak gelebilir
                  if (typeof expression === 'string') {
                    expressionContent = expression;
                  } 
                  // Veya bir obje olarak gelebilir ve içeriği '#text' property'sinde olabilir
                  else if ('#text' in expression || expression['#text']) {
                    expressionContent = expression['#text'] as string;
                  }
                  // Veya doğrudan objenin kendisi olabilir
                  else {
                    expressionContent = JSON.stringify(expression);
                  }

                  if (expressionContent.toLowerCase().includes(searchText.toLowerCase())) {
                    // Üst sequence flow elementinin adını bulmaya çalış
                    let parentName = '';
                    if (obj['@_name']) {
                      parentName = obj['@_name'] as string;
                    } else if (obj['@_sourceRef'] && obj['@_targetRef']) {
                      parentName = `${obj['@_sourceRef']} -> ${obj['@_targetRef']}`;
                    }

                    references.push({
                      fileName: file.webkitRelativePath || file.name,
                      xmlContent: content,
                      matchingElement: `Condition Expression${parentName ? ` (${parentName})` : ''}`,
                      elementType: 'conditionExpression',
                      matchedText: expressionContent,
                      elementId: obj['@_id'] || `condition_expression_${Date.now()}`,
                      parentElementName: parentName,
                      processName: processName || 'İsimsiz Süreç',
                      previewRef: React.createRef<HTMLDivElement>(),
                      matchedElements: [{
                        elementId: obj['@_id'] || `condition_expression_${Date.now()}`,
                        elementType: 'conditionExpression',
                        matchingElement: `Condition Expression${parentName ? ` (${parentName})` : ''}`,
                        matchedText: expressionContent
                      }]
                    });
                  }
                });
              }

              if (typeof obj[key] === 'object') {
                findElements(obj[key] as XmlObject);
              }
            }
          }
        };

        findElements(xmlObj);
      }

      setResults(references);
    } catch (error) {
      console.error('Error analyzing BPMN files:', error);
      alert('BPMN dosyalarını analiz ederken bir hata oluştu. Detaylar için konsolu kontrol edin.');
    } finally {
      setIsLoading(false);
    }
  }, [searchText, selectedFiles]);

  // Arama tipine göre analiz fonksiyonunu seç
  const handleSearch = useCallback(() => {
    if (searchType === 'processId') {
      analyzeBPMNFiles();
    } else {
      analyzeTextInBPMN();
    }
  }, [searchType, analyzeBPMNFiles, analyzeTextInBPMN]);

  // Pagination için gerekli hesaplamalar
  const totalPages = Math.ceil(filteredResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentResults = filteredResults.slice(startIndex, endIndex);

  // Sayfa değiştirme fonksiyonu - artık viewer'ları burada temizlemeye gerek yok
  const handlePageChange = (pageNumber: number) => {
    setCurrentPage(pageNumber);
  };

  // Dosya seçildiğinde veya process ID değiştiğinde pagination'ı sıfırla
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(e.target.files);
      setResults([]);
      setHasSearched(false);
      setCurrentPage(1);
    }
  };

  return (
    <div className={`min-h-screen transition-colors duration-200 ${
      isDarkMode ? 'bg-gray-900' : 'bg-gradient-to-b from-gray-50 to-gray-100'
    } py-8 px-4`}>
      <div className="max-w-4xl mx-auto">
        <div className="relative flex flex-col items-center mb-8">
          <h1 className={`text-4xl font-bold text-center ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
            BPMN Process Search
          </h1>
          <p className={`mt-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'} text-center text-lg`}>
            Find process references in your BPMN files
          </p>
          <div className="absolute right-0 top-0 flex items-center gap-2">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-2 rounded-lg transition-colors ${
                isDarkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setShowInfo(true)}
              className={`p-2 rounded-lg transition-colors ${
                isDarkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="How to Use?"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Update How to Use modal */}
        {showInfo && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className={`${
              isDarkMode ? 'bg-gray-800' : 'bg-white'
            } rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto`}>
              <div className={`p-6 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-100'}`}>
                <div className="flex justify-between items-center">
                  <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    How to Use?
                  </h2>
                  <button
                    onClick={() => setShowInfo(false)}
                    className={`p-2 ${
                      isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                    } rounded-lg transition-colors`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                  <section>
                    <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'} mb-2 flex items-center gap-2`}>
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm">1</span>
                      Search Type Selection
                    </h3>
                    <p className={`${isDarkMode ? 'text-gray-300' : 'text-gray-600'} ml-8`}>
                      There are two different search types:
                    </p>
                    <ul className="list-disc ml-16 mt-2 space-y-2">
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>
                        <strong>Search by Process ID:</strong> Searches for a Process ID referenced in other processes
                      </li>
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>
                        <strong>Search by Text:</strong> Searches for text in Script, Call Activity, and Condition Expression contents
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'} mb-2 flex items-center gap-2`}>
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm">2</span>
                      File Selection
                    </h3>
                    <p className={`${isDarkMode ? 'text-gray-300' : 'text-gray-600'} ml-8`}>
                      Click the "Select Files" button to choose the folder containing your BPMN files. All .bpmn and .xml files in the selected folder will be automatically scanned.
                    </p>
                  </section>

                  <section>
                    <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'} mb-2 flex items-center gap-2`}>
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm">3</span>
                      Search Results
                    </h3>
                    <p className={`${isDarkMode ? 'text-gray-300' : 'text-gray-600'} ml-8`}>
                      The search results show the following information:
                    </p>
                    <ul className="list-disc ml-16 mt-2 space-y-2">
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>File path and name</li>
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Process name</li>
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Found elements and their contents</li>
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Highlighted elements on the BPMN diagram</li>
                    </ul>
                  </section>

                  <section>
                    <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'} mb-2 flex items-center gap-2`}>
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm">4</span>
                      Filtering and Viewing
                    </h3>
                    <p className={`${isDarkMode ? 'text-gray-300' : 'text-gray-600'} ml-8`}>
                      Additional operations on results:
                    </p>
                    <ul className="list-disc ml-16 mt-2 space-y-2">
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Filter by folder, file, or process name</li>
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Zoom in/out on the diagram</li>
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Drag the diagram with mouse</li>
                      <li className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>View multiple results with pagination</li>
                    </ul>
                  </section>
                </div>
              </div>
              <div className={`p-6 border-t ${isDarkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-100 bg-gray-50'}`}>
                <button
                  onClick={() => setShowInfo(false)}
                  className="w-full py-2 px-4 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors"
                >
                  I Understand
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Update scroll to top button */}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={`fixed right-8 bottom-8 p-4 rounded-full shadow-lg transition-all duration-200 ${
            isDarkMode 
              ? 'bg-gray-800 text-blue-400 hover:bg-gray-700 hover:text-blue-300' 
              : 'bg-white text-blue-500 hover:bg-blue-50'
          }`}
          title="Scroll to Top"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>

        <div className={`${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'
        } rounded-xl shadow-lg p-8 mb-8 border`}>
          <div className="mb-6">
            <label className={`block text-sm font-semibold ${
              isDarkMode ? 'text-gray-300' : 'text-gray-700'
            } mb-2`}>
              Search Type
            </label>
            <div className="flex gap-4 mb-4">
              <button
                onClick={() => setSearchType('processId')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  searchType === 'processId'
                    ? 'bg-blue-500 text-white'
                    : isDarkMode 
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Search by Process ID
              </button>
              <button
                onClick={() => setSearchType('text')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  searchType === 'text'
                    ? 'bg-blue-500 text-white'
                    : isDarkMode 
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Search by Text
              </button>
            </div>

            {searchType === 'processId' ? (
              <div>
                <label 
                  htmlFor="processId" 
                  className={`block text-sm font-semibold ${
                    isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  } mb-2`}
                >
                  Process ID
                </label>
                <input
                  id="processId"
                  type="text"
                  value={searchProcessId}
                  onChange={(e) => setSearchProcessId(e.target.value)}
                  className={`w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                    isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400' : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'
                  }`}
                  placeholder="Enter process ID to search..."
                />
              </div>
            ) : (
              <div>
                <label 
                  htmlFor="searchText" 
                  className={`block text-sm font-semibold ${
                    isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  } mb-2`}
                >
                  Search Text
                </label>
                <input
                  id="searchText"
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className={`w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                    isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400' : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'
                  }`}
                  placeholder="Enter text to search in Script or Call Activity..."
                />
              </div>
            )}
          </div>

          <div className="mb-6">
            <label className={`block text-sm font-semibold ${
              isDarkMode ? 'text-gray-300' : 'text-gray-700'
            } mb-2`}>
              BPMN Files
            </label>
            <div className="flex gap-3 items-center">
              <input
                id="folder"
                type="file"
                // @ts-expect-error - webkitdirectory özelliği TypeScript'te tanımlı değil
                webkitdirectory=""
                directory=""
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => document.getElementById('folder')?.click()}
                className={`px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isDarkMode
                    ? 'bg-gray-700 text-blue-400 hover:bg-gray-600'
                    : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              >
                Select Files
              </button>
              <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {selectedFiles ? (
                  <span className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {selectedFiles.length} files selected
                    </span>
                  </span>
                ) : (
                  <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>
                    No files selected
                  </span>
                )}
              </span>
            </div>
          </div>

          <button
            onClick={handleSearch}
            disabled={!selectedFiles || (!searchProcessId && !searchText) || isLoading}
            className={`w-full py-3 px-4 rounded-lg text-white font-medium transition-all duration-200 ${
              !selectedFiles || (!searchProcessId && !searchText) || isLoading
                ? isDarkMode ? 'bg-gray-700 cursor-not-allowed' : 'bg-gray-300 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 shadow-md hover:shadow-lg'
            }`}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Analyzing...
              </span>
            ) : searchType === 'processId' ? 'Search References' : 'Search Text'}
          </button>
        </div>

        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
            <p className="mt-4 text-gray-600 text-lg">Dosyalar analiz ediliyor...</p>
          </div>
        )}

        {!isLoading && results.length > 0 && (
          <div className={`${
            isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'
          } rounded-xl shadow-lg p-8`}>
            <div className="flex justify-between items-center mb-6">
              <h2 className={`text-2xl font-bold ${
                isDarkMode ? 'text-white' : 'text-gray-800'
              } flex items-center gap-2`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Results ({filteredResults.length})
              </h2>
              <div className="relative">
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Search in folder, file or process name..."
                  className={`w-80 px-4 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                    isDarkMode
                      ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400'
                      : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'
                  }`}
                />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="space-y-6">
              {currentResults.map((ref, index) => (
                <div 
                  key={index}
                  className={`border rounded-lg overflow-hidden transition-all duration-200 hover:shadow-md ${
                    isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="p-6">
                    <div className="space-y-3">
                      <p className={`font-medium text-sm whitespace-nowrap overflow-hidden text-ellipsis ${
                        isDarkMode ? 'text-gray-300' : 'text-gray-800'
                      }`}>
                        <span className={`font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Folder: </span>
                        {ref.fileName.split('/').slice(0, -1).join('/')}
                      </p>
                      <p className={`font-medium text-sm whitespace-nowrap overflow-hidden text-ellipsis ${
                        isDarkMode ? 'text-gray-300' : 'text-gray-800'
                      }`}>
                        <span className={`font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>File: </span>
                        {ref.fileName.split('/').pop()}
                      </p>
                      {ref.processName && (
                        <p className={`font-medium text-sm whitespace-nowrap overflow-hidden text-ellipsis ${
                          isDarkMode ? 'text-gray-300' : 'text-gray-800'
                        }`}>
                          <span className={`font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Process Name: </span>
                          {ref.processName}
                        </p>
                      )}
                      {ref.matchedElements?.map((match, matchIndex) => (
                        <div key={matchIndex} className="space-y-3">
                          <p className={`text-sm font-mono p-3 rounded-lg whitespace-nowrap overflow-hidden text-ellipsis border ${
                            isDarkMode 
                              ? 'bg-gray-700 border-gray-600 text-gray-300' 
                              : 'bg-gray-50 border-gray-100 text-gray-600'
                          }`}>
                            <span className={`font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Element {matchIndex + 1}: </span>
                            {match.matchingElement}
                          </p>
                          {match.elementType && (
                            <p className={`text-sm font-mono p-3 rounded-lg whitespace-nowrap overflow-hidden text-ellipsis border ${
                              isDarkMode 
                                ? 'bg-gray-700 border-gray-600 text-gray-300' 
                                : 'bg-gray-50 border-gray-100 text-gray-600'
                            }`}>
                              <span className={`font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Element Type: </span>
                              {match.elementType === 'callActivity' ? 'Call Activity' : 
                               match.elementType === 'scriptTask' ? 'Script Task' : 
                               match.elementType === 'conditionExpression' ? 'Condition Expression' : 'Script'}
                            </p>
                          )}
                          {match.matchedText && (
                            <div className={`text-sm font-mono p-3 rounded-lg border overflow-hidden ${
                              isDarkMode 
                                ? 'bg-gray-700 border-gray-600 text-gray-300' 
                                : 'bg-gray-50 border-gray-100 text-gray-600'
                            }`}>
                              <p className={`font-semibold mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Matched Content {matchIndex + 1}:</p>
                              <pre className="whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                                {match.matchedText}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className={`border-t p-3 flex items-center justify-end gap-2 ${
                    isDarkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-100 bg-gray-50'
                  }`}>
                    <button
                      onClick={() => handleZoom(index, 'out')}
                      className={`p-2 rounded-lg transition-colors ${
                        isDarkMode 
                          ? 'text-gray-400 hover:text-blue-400 hover:bg-gray-700' 
                          : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
                      }`}
                      title="Zoom Out"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleZoom(index, 'fit')}
                      className={`p-2 rounded-lg transition-colors ${
                        isDarkMode 
                          ? 'text-gray-400 hover:text-blue-400 hover:bg-gray-700' 
                          : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
                      }`}
                      title="Fit to Screen"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293-2.293a1 1 0 111.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleZoom(index, 'in')}
                      className={`p-2 rounded-lg transition-colors ${
                        isDarkMode 
                          ? 'text-gray-400 hover:text-blue-400 hover:bg-gray-700' 
                          : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
                      }`}
                      title="Zoom In"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                  <div 
                    ref={ref.previewRef}
                    className="w-full h-[300px] relative bpmn-preview border-t border-gray-100"
                  />
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex justify-center items-center gap-1">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className={`p-2 rounded-lg transition-colors ${
                    currentPage === 1
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-blue-600 hover:bg-blue-50'
                  }`}
                  title="Previous Page"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(pageNumber => {
                    // İlk ve son sayfaları her zaman göster
                    if (pageNumber === 1 || pageNumber === totalPages) return true;
                    // Mevcut sayfanın bir öncesi ve bir sonrasını göster
                    if (Math.abs(pageNumber - currentPage) <= 1) return true;
                    return false;
                  })
                  .map((pageNumber, index, array) => {
                    // Eğer sayılar arasında boşluk varsa "..." ekle
                    if (index > 0 && array[index] - array[index - 1] > 1) {
                      return (
                        <React.Fragment key={`ellipsis-${pageNumber}`}>
                          <span className="px-3 py-2 text-gray-400">...</span>
                          <button
                            onClick={() => handlePageChange(pageNumber)}
                            className={`min-w-[40px] h-10 rounded-lg transition-all duration-200 ${
                              currentPage === pageNumber
                                ? 'bg-blue-500 text-white font-medium shadow-md'
                                : 'text-gray-600 hover:bg-blue-50'
                            }`}
                          >
                            {pageNumber}
                          </button>
                        </React.Fragment>
                      );
                    }
                    return (
                      <button
                        key={pageNumber}
                        onClick={() => handlePageChange(pageNumber)}
                        className={`min-w-[40px] h-10 rounded-lg transition-all duration-200 ${
                          currentPage === pageNumber
                            ? 'bg-blue-500 text-white font-medium shadow-md'
                            : 'text-gray-600 hover:bg-blue-50'
                        }`}
                      >
                        {pageNumber}
                      </button>
                    );
                  })}

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className={`p-2 rounded-lg transition-colors ${
                    currentPage === totalPages
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-blue-600 hover:bg-blue-50'
                  }`}
                  title="Next Page"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}

        {!isLoading && hasSearched && results.length === 0 && (searchProcessId || searchText) && selectedFiles && (
          <div className={`${
            isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'
          } rounded-xl shadow-lg p-8 text-center`}>
            <div className="mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-16 w-16 ${
                isDarkMode ? 'text-gray-600' : 'text-gray-400'
              } mx-auto`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className={`text-xl font-semibold ${
              isDarkMode ? 'text-white' : 'text-gray-800'
            } mb-2`}>
              No Results Found
            </h3>
            <p className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>
              {searchType === 'processId' 
                ? 'No references found with the specified Process ID. Please check the ID and try again.'
                : 'No content found matching the specified text. Please try a different search term.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;