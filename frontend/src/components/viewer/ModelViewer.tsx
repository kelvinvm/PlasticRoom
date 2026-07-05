import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { LoadedModel } from '../../lib/modelLoading'
import { applyRenderMode, setActivePlate, type RenderMode } from '../../lib/viewerModes'
import styles from './ModelViewer.module.css'

export function ModelViewer({
  model,
  mode,
  activePlate,
}: {
  model: LoadedModel
  mode: RenderMode
  activePlate: number | null
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<{ update: () => void; dispose: () => void } | null>(null)
  const frameRef = useRef<number>(0)

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

      const center = new THREE.Vector3()
      const extent = new THREE.Vector3()
      model.bounds.getCenter(center)
      model.bounds.getSize(extent)
      const radius = Math.max(extent.x, extent.y, extent.z) || 1

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, radius * 100)
      camera.position.set(center.x + radius * 1.6, center.y + radius * 1.4, center.z + radius * 1.6)
      camera.lookAt(center)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.target.copy(center)
      controls.update()

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
        renderer.forceContextLoss()
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
    setActivePlate(model.objects, activePlate)
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current)
    }
  }, [model, mode, activePlate])

  return (
    <div className={styles.stage}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <span className={styles.hint}>DRAG TO ORBIT · SCROLL TO ZOOM</span>
    </div>
  )
}
