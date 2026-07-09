export class Vector2D {
    constructor(public x: number = 0, public y: number = 0) { }

    add(v: Vector2D): this {
        this.x += v.x;
        this.y += v.y;
        return this;
    }
    sub(v: Vector2D): this {
        this.x -= v.x;
        this.y -= v.y;
        return this;
    }
    set(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }

    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    dot(v: Vector2D): number {
        return this.x * v.x + this.y * v.y;
    }
    clone(): Vector2D {
        return new Vector2D(this.x, this.y);
    }

    normalise(): this {
        const len = Math.sqrt(this.x * this.x + this.y * this.y);
        if (len > 0) {
            this.x /= len;
            this.y /= len;
        }
        return this;
    }

    scale(scalar: number): this {
        this.x *= scalar;
        this.y *= scalar;
        return this;
    }
    setDiff(v1: Vector2D, v2: Vector2D): this {
        this.x = v1.x - v2.x;
        this.y = v1.y - v2.y;
        return this;
    }
    limit(max: number): this {
        const lenSq = this.x * this.x + this.y * this.y;
        if (lenSq > max * max) {
            const len = Math.sqrt(lenSq);
            this.x = (this.x / len) * max;
            this.y = (this.y / len) * max;
        }
        return this;
    }

}
