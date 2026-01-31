/**
 * WebGL Chroma Key Utility
 *
 * GPU-accelerated chroma keying (green screen removal) using WebGL.
 * Converts green background to transparent in real-time video streams.
 *
 * Features:
 * - WebGL 2.0 / WebGL 1.0 fallback
 * - YUV color space for accurate green detection
 * - Smooth edge blending
 * - Real-time processing via requestAnimationFrame
 *
 * Usage:
 * ```typescript
 * const chromaKey = createChromaKeyProcessor(videoElement, canvasElement);
 * chromaKey.start();
 * ```
 */

import { ChromaKeyConfig } from '../types';

/**
 * Default green screen configuration
 */
export const DEFAULT_GREEN_SCREEN: ChromaKeyConfig = {
  keyColor: [0.0, 1.0, 0.0], // Pure green
  similarity: 0.4,
  smoothness: 0.1,
};

/**
 * Vertex Shader
 * Passes through position and texture coordinates
 */
const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

/**
 * Fragment Shader
 * Performs chroma keying in YUV color space for better color accuracy
 */
const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_image;
  uniform vec3 u_keyColor;
  uniform float u_similarity;
  uniform float u_smoothness;

  // Convert RGB to YUV color space
  // YUV provides better separation between luminance and chrominance
  vec3 rgb2yuv(vec3 rgb) {
    float y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    float u = (rgb.b - y) * 0.565;
    float v = (rgb.r - y) * 0.713;
    return vec3(y, u, v);
  }

  void main() {
    vec4 color = texture2D(u_image, v_texCoord);

    // Convert both pixel and key colors to YUV
    vec3 yuv = rgb2yuv(color.rgb);
    vec3 keyYuv = rgb2yuv(u_keyColor);

    // Calculate color distance in UV space (ignore luminance)
    float colorDistance = distance(yuv.yz, keyYuv.yz);

    // Smooth alpha transition based on similarity threshold
    float alpha = smoothstep(u_similarity, u_similarity + u_smoothness, colorDistance);

    gl_FragColor = vec4(color.rgb, alpha * color.a);
  }
`;

/**
 * Compile a WebGL shader
 */
function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  source: string,
  type: number
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

/**
 * Create and link a WebGL program
 */
function createProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    return null;
  }

  return program;
}

/**
 * Setup WebGL buffers and attributes
 */
function setupGeometry(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  program: WebGLProgram
): void {
  // Full-screen quad positions (2 triangles)
  const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

  // Texture coordinates
  const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]);

  // Position buffer
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  // Texture coordinate buffer
  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
  const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
  gl.enableVertexAttribArray(texCoordLocation);
  gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
}

/**
 * Setup WebGL texture
 */
function setupTexture(
  gl: WebGLRenderingContext | WebGL2RenderingContext
): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) return null;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  return texture;
}

/**
 * Chroma Key Processor
 * Manages WebGL rendering loop for chroma keying
 */
export interface ChromaKeyProcessor {
  /** Start the chroma key processing */
  start: () => void;
  /** Stop the chroma key processing */
  stop: () => void;
  /** Update chroma key configuration */
  updateConfig: (config: Partial<ChromaKeyConfig>) => void;
}

/**
 * Create a chroma key processor
 *
 * @param video - Source video element
 * @param canvas - Target canvas element for output
 * @param config - Chroma key configuration (optional)
 * @returns Chroma key processor controller
 */
export function createChromaKeyProcessor(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  config: ChromaKeyConfig = DEFAULT_GREEN_SCREEN
): ChromaKeyProcessor | null {
  // Get WebGL context (prefer WebGL2)
  const gl =
    canvas.getContext("webgl2") || canvas.getContext("webgl");

  if (!gl) {
    console.error("WebGL not supported");
    return null;
  }

  // Set canvas size to match video
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);

  // Compile shaders
  const vertexShader = compileShader(gl, VERTEX_SHADER_SOURCE, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(
    gl,
    FRAGMENT_SHADER_SOURCE,
    gl.FRAGMENT_SHADER
  );

  if (!vertexShader || !fragmentShader) {
    return null;
  }

  // Create program
  const program = createProgram(gl, vertexShader, fragmentShader);
  if (!program) {
    return null;
  }

  gl.useProgram(program);

  // Setup geometry and texture
  setupGeometry(gl, program);
  const texture = setupTexture(gl);
  if (!texture) {
    return null;
  }

  // Get uniform locations
  const keyColorLocation = gl.getUniformLocation(program, "u_keyColor");
  const similarityLocation = gl.getUniformLocation(program, "u_similarity");
  const smoothnessLocation = gl.getUniformLocation(program, "u_smoothness");

  // Set initial chroma key parameters
  gl.uniform3f(keyColorLocation, ...config.keyColor);
  gl.uniform1f(similarityLocation, config.similarity);
  gl.uniform1f(smoothnessLocation, config.smoothness);

  // Enable alpha blending
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let animationFrameId: number | null = null;

  // Render loop
  const processFrame = () => {
    if (!video.paused && !video.ended) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameId = requestAnimationFrame(processFrame);
    }
  };

  // Start processing when video plays
  const onPlay = () => processFrame();
  video.addEventListener("play", onPlay);

  return {
    start: () => {
      if (!video.paused && !video.ended) {
        processFrame();
      }
    },

    stop: () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      video.removeEventListener("play", onPlay);
    },

    updateConfig: (newConfig: Partial<ChromaKeyConfig>) => {
      if (newConfig.keyColor) {
        gl.uniform3f(keyColorLocation, ...newConfig.keyColor);
      }
      if (newConfig.similarity !== undefined) {
        gl.uniform1f(similarityLocation, newConfig.similarity);
      }
      if (newConfig.smoothness !== undefined) {
        gl.uniform1f(smoothnessLocation, newConfig.smoothness);
      }
    },
  };
}
