import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { LoadedModel } from '../../lib/modelLoading'
import {
  applyRenderMode,
  setVisibleObjects,
  frameCameraToBox,
  boundsForObjects,
  type RenderMode,
} from '../../lib/viewerModes'
import styles from './ModelViewer.module.css'

export function ModelViewer({
  model,
  mode,
  visibleIndices,
}: {
  model: LoadedModel
  mode: RenderMode
  visibleIndices: number[] | null
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<{ update: () => void; dispose: () => void; target: THREE.Vector3 } | null>(null)
  const frameRef = useRef<number>(0)
  // Key of the visible set the camera was last framed to; guards against
  // re-framing (and stealing the user's orbit/zoom) on unrelated re-renders.
  const frameKeyRef = useRef<string | null>(null)

  // Scene setup — runs once per loaded model.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      const parent = canvas.parentElement
      const width = parent?.clientWidth || 800
      const height = parent?.clientHeight || 600
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.setSize(width, height, false)

      const scene = new THREE.Scene()
      scene.add(new THREE.AmbientLight(0xffffff, 0.7))
      const key = new THREE.DirectionalLight(0xffffff, 0.9)
      key.position.set(1, 1, 1)
      scene.add(key)
      scene.add(model.object)

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true

      // Initial view fills the viewport with the whole model.
      frameCameraToBox(camera, controls.target, model.bounds)
      controls.update()
      frameKeyRef.current = 'all'

      rendererRef.current = renderer
      sceneRef.current = scene
      cameraRef.current = camera
      controlsRef.current = controls

      const animate = () => {
        frameRef.current = requestAnimationFrame(animate)
        controls.update()
        renderer.render(scene, camera)
      }
      animate()

      const onResize = () => {
        const p = canvas.parentElement
        if (!p) return
        renderer.setSize(p.clientWidth, p.clientHeight, false)
        camera.aspect = p.clientWidth / p.clientHeight
        camera.updateProjectionMatrix()
      }
      window.addEventListener('resize', onResize)

      return () => {
        window.removeEventListener('resize', onResize)
        cancelAnimationFrame(frameRef.current)
        controls.dispose()
        scene.remove(model.object)
        model.object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose?.()
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose())
            } else {
              child.material?.dispose?.()
            }
          }
        })
        // NOTE: do NOT call renderer.forceContextLoss() here. Under React
        // StrictMode (dev), effects run mount→cleanup→mount on the SAME retained
        // canvas; forceContextLoss permanently loses that canvas's WebGL context,
        // so the remount renders nothing ("THREE.WebGLRenderer: Context Lost").
        // dispose() frees GPU resources without killing the context; on a real
        // unmount the canvas node is removed and the context is reclaimed.
        renderer.dispose()
        rendererRef.current = null
      }
    } catch {
      // WebGL unavailable (e.g. jsdom test env) — no-op; real rendering is
      // verified by running the app.
      return
    }
  }, [model])

  // Apply render mode + plate isolation whenever they change.
  useEffect(() => {
    applyRenderMode(model.objects, mode)
    setVisibleObjects(model.objects, visibleIndices)
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current)
    }
  }, [model, mode, visibleIndices])

  // Re-frame the camera to fill the viewport with the currently visible objects
  // whenever the visible SET changes (filmstrip plate click / All), so a plate
  // that sits off-screen doesn't require manual zooming to find. Value-keyed so a
  // new-but-equal visibleIndices array from an unrelated re-render (e.g. a
  // description save) doesn't reset the user's manual orbit/zoom.
  useEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return

    const key = visibleIndices === null ? 'all' : [...visibleIndices].sort((a, b) => a - b).join(',')
    if (key === frameKeyRef.current) return
    frameKeyRef.current = key

    const box =
      visibleIndices === null ? model.bounds : boundsForObjects(model.objects, visibleIndices)
    frameCameraToBox(camera, controls.target, box)
    controls.update()
    if (rendererRef.current && sceneRef.current) {
      rendererRef.current.render(sceneRef.current, camera)
    }
  }, [model, visibleIndices])

  return (
    <div className={styles.stage}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <span className={styles.hint}>DRAG TO ORBIT · SCROLL TO ZOOM</span>
    </div>
  )
}
