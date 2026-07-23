export class RainShader {
    constructor(gameCanvas) {
        this.gameCanvas = gameCanvas;
        this.canvas = document.createElement('canvas');
        this.canvas.width = gameCanvas.width;
        this.canvas.height = gameCanvas.height;
        this.gl = this.canvas.getContext('webgl', { alpha: true });
        
        if (!this.gl) {
            console.warn("WebGL not supported, falling back without rain shader");
            return;
        }
        
        this.initShaders();
        this.initBuffers();
        this.time = 0;
        this.wind = 0.0;
        this.speed = 1.0;
        this.lastTime = 0;
    }
    
    initShaders() {
        const gl = this.gl;
        
        const vsSource = `
            attribute vec2 a_position;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;
        
        const fsSource = `
            precision mediump float;

            uniform float u_time;
            uniform vec2 u_resolution;
            uniform float u_speed;

            //==================================================
            // НАСТРОЙКИ
            //==================================================

            // Количество слоев
            const int LAYERS = 4;

            // Расстояние между колонками капель
            const float BASE_SCALE = 30.0;
            const float SCALE_STEP = 18.0;

            // Скорость
            const float BASE_SPEED = 0.95;
            const float SPEED_VARIATION = 0.55;
            const float LAYER_SPEED = 0.20;

            // Плотность (меньше = больше дождя)
            const float DROP_DENSITY = 0.55;

            // Толщина капель
            const float BASE_THICKNESS = 0.028;
            const float THICKNESS_STEP = 0.012;

            // Длина капель
            const float MIN_LENGTH = 0.25;
            const float MAX_LENGTH = 0.75;

            // Яркость
            const float BASE_INTENSITY = 0.18;
            const float INTENSITY_STEP = 0.18;

            // Цвет
            const vec3 RAIN_COLOR = vec3(0.78, 0.88, 1.00);

            const float COLOR_STRENGTH = 0.35;
            const float GLOW_STRENGTH = 0.05;
            const float MIST_STRENGTH = 0.025;
            const float ALPHA_STRENGTH = 0.15;

            // Ветер
            const float WIND_FREQ1 = 0.05;
            const float WIND_FREQ2 = 0.013;
            const float WIND_FREQ3 = 0.18;

            const float WIND1 = 0.55;
            const float WIND2 = 0.35;
            const float WIND3 = 0.10;

            const float WIND_MIN = 0.35;
            const float WIND_MAX = 1.0;

            // Джиттер
            const float JITTER_AMOUNT = 0.0025;
            const float JITTER_SPEED = 0.9;

            //==================================================

            float hash(float n)
            {
                return fract(sin(n) * 43758.5453123);
            }

            void main()
            {
                vec2 uv = gl_FragCoord.xy / u_resolution;

                float rain = 0.0;

                //--------------------------------------------------
                // Ветер
                //--------------------------------------------------

                float wind =
                    sin(u_time * WIND_FREQ1) * WIND1
                    + sin(u_time * WIND_FREQ2 + 2.1) * WIND2
                    + sin(u_time * WIND_FREQ3 + 4.7) * WIND3;

                float gust =
                    smoothstep(
                        0.25,
                        0.95,
                        sin(u_time * 0.028 + 1.3) * 0.5 + 0.5
                    );

                wind *= mix(WIND_MIN, WIND_MAX, gust);

                //--------------------------------------------------
                // Дождь
                //--------------------------------------------------

                for(int i = 0; i < LAYERS; i++)
                {
                    float layer = float(i);

                    float scale =
                        BASE_SCALE +
                        layer * SCALE_STEP;

                    vec2 p = uv;

                    float layerWind =
                        wind *
                        (0.08 + layer * 0.045);

                    p.x -= p.y * layerWind;

                    // Джиттер только если есть ветер
                    float jitter =
                        abs(layerWind) *
                        JITTER_AMOUNT;

                    p.x +=
                        sin(
                            p.y * 12.0 +
                            layer * 4.0 +
                            u_time * JITTER_SPEED
                        ) * jitter;

                    p.x *= scale;

                    float col = floor(p.x);

                    float h =
                        hash(col + layer * 21.0);

                    float speed =
                        u_speed *
                        BASE_SPEED *
                        (1.0 + h * SPEED_VARIATION) *
                        (1.0 + layer * LAYER_SPEED);

                    // Не даем времени стать огромным
                    float t =
                        mod(u_time * speed, 100.0);

                    float layerScale =
                        1.4 +
                        layer * 0.28;

                    float y =
                        p.y * layerScale +
                        t;

                    float row = floor(y);

                    float fy = fract(y);
                    float fx = fract(p.x);

                    float drop =
                        hash(
                            col * 17.0 +
                            row * 31.0 +
                            layer * 73.0
                        );

                    if(drop > DROP_DENSITY)
                    {
                        float thickness =
                            BASE_THICKNESS +
                            layer * THICKNESS_STEP;

                        float dropLength =
                            mix(
                                MIN_LENGTH,
                                MAX_LENGTH,
                                hash(
                                    col * 9.0 +
                                    row * 5.0
                                )
                            );

                        float glowX =
                            smoothstep(
                                thickness,
                                0.0,
                                abs(fx - 0.5)
                            );

                        float glowY =
                            smoothstep(
                                dropLength,
                                0.0,
                                fy
                            ) *
                            smoothstep(
                                0.0,
                                0.08,
                                fy
                            );

                        float alpha =
                            (0.35 + h * 0.65) *
                            (0.45 + drop * 0.55);

                        float intensity =
                            BASE_INTENSITY +
                            layer * INTENSITY_STEP;

                        rain +=
                            glowX *
                            glowY *
                            alpha *
                            intensity;
                    }
                }

                //--------------------------------------------------
                // Дымка
                //--------------------------------------------------

                float mist =
                    smoothstep(
                        0.0,
                        1.0,
                        uv.y
                    );

                //--------------------------------------------------
                // Цвет
                //--------------------------------------------------

                vec3 color =
                    RAIN_COLOR *
                    rain *
                    COLOR_STRENGTH;

                color +=
                    vec3(1.0) *
                    pow(rain, 2.0) *
                    GLOW_STRENGTH;

                color +=
                    vec3(
                        0.04,
                        0.06,
                        0.08
                    ) *
                    mist *
                    MIST_STRENGTH;

                gl_FragColor =
                    vec4(
                        color,
                        rain * ALPHA_STRENGTH
                    );
            }
        `;
        
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);
        
        this.locations = {
            position: gl.getAttribLocation(this.program, 'a_position'),
            time: gl.getUniformLocation(this.program, 'u_time'),
            resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            wind: gl.getUniformLocation(this.program, 'u_wind'),
            speed: gl.getUniformLocation(this.program, 'u_speed')
        };
    }
    
    initBuffers() {
        const gl = this.gl;
        const vertices = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
            -1,  1,
             1, -1,
             1,  1
        ]);
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    }
    
    update() {
        if (!this.gl) return;
        
        const now = performance.now();
        if (this.lastTime === 0) this.lastTime = now;
        let dt = (now - this.lastTime) / 1000;
        this.lastTime = now;
        
        // Капим dt во избежание скачков при неактивной вкладке браузера
        if (dt > 0.1) dt = 0.1;
        
        this.time += dt;
        
        // Направление ветра меняется ОЧЕНЬ медленно и плавно (период ~2.5 мин)
        // Наклон меняется в пределах [-0.35, 0.35]
        this.wind = Math.sin(this.time * 0.04) * 0.35;
        
        // Скорость меняется ОЧЕНЬ медленно и плавно в пределах [0.7, 1.0]
        this.speed = 0.85 + Math.cos(this.time * 0.06) * 0.15;
    }
    
    draw() {
        const gl = this.gl;
        if (!gl) return;
        
        if (this.canvas.width !== this.gameCanvas.width || this.canvas.height !== this.gameCanvas.height) {
            this.canvas.width = this.gameCanvas.width;
            this.canvas.height = this.gameCanvas.height;
        }
        
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.useProgram(this.program);
        gl.enableVertexAttribArray(this.locations.position);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
        
        gl.uniform1f(this.locations.time, this.time);
        gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.locations.wind, this.wind);
        gl.uniform1f(this.locations.speed, this.speed);
        
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    
    getCanvas() {
        return this.canvas;
    }
}
