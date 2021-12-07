/**
 * @file Interactive vector field animation using the HTML5 canvas.
 * @version 1.0
 * @author Andrew Byers (changmn)
 * @license MIT
 */

"use strict";

/**
 * The 2-D canvas drawing context.
 * @type {CanvasRenderingContext2D}
 */
let ctx;

/**
 * The HTML5 canvas element.
 * @type {HTMLCanvasElement}
 */
let canvas;

/**
 * The vector field object.
 * @type {VectorField}
 */
let field;

/**
 * Get the distance between two points.
 * @function
 *
 * @param {Number} x0 - The x-coordinate of the first point.
 * @param {Number} y0 - The y-coordinate of the first point.
 * @param {Number} x1 - The x-coordinate of the second point.
 * @param {Number} y1 - The y-coordinate of the second point.
 *
 * @returns {Number}
 */
let dist = (x0, y0, x1, y1) => Math.sqrt((x1-x0)*(x1-x0) + (y1-y0)*(y1-y0));

/**
 * Get the angle of a line connecting two points.
 * @function
 *
 * @param {Number} x0 - The x-coordinate of the first point.
 * @param {Number} y0 - The y-coordinate of the first point.
 * @param {Number} x1 - The x-coordinate of the second point.
 * @param {Number} y1 - The y-coordinate of the second point.
 *
 * @returns {Number} - The arctangent of the y-difference divided by the
 *                     x-difference between the points.
 */
let angleBetween = (x0, y0, x1, y1) => Math.atan2(y1-y0, x1-x0);

/**
 * An object representing a vector.
 * @class
 *
 * @property {Number} midX - The x-coordinate of the vector's midpoint.
 * @property {Number} midY - The y-coordinate of the vector's midpoint.
 * @property {Number} angle - The angle between the midpoint and the cursor.
 * @property {Number} len - The vector's magnitude.
 */
function Vector(midX, midY) {
    this.midX = midX;
    this.midY = midY;
    this.angle = null;
    this.len = null;
    /**
     * Draw the vector.
     * @function
     *
     * @param {String} color - The color of the vector in HSL format.
     */
    this.draw = function(color) {
        let dy = this.len * Math.sin(this.angle),
            dx = this.len * Math.cos(this.angle),
            y0 = this.midY + dy / 2,
            x0 = this.midX + dx / 2,
            y1 = y0 - dy,
            x1 = x0 - dx;

        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();

        /* Draw a line from one end to the other, which will run through
         * the midpoint at (this.midX, this.midY). */
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        this.drawArrow(x0, y0, color);
    };
    /**
     * Update the vector with the new cursor position.
     * @method
     *
     * @param {Number} mouseX - The x-coordinate of the cursor.
     * @param {Number} mouseY - The y-coordinate of the cursor.
     */
    this.update = function(time) {
        let d, hue,
            factor;

        /* Update the angle to point to the cursor and get the distance
         * in pixels to the cursor. */
        // this.angle = angleBetween(this.midX, this.midY, mouseX, mouseY);
        // d = dist(this.midX, this.midY, mouseX, mouseY);

        // windangle
        this.angle = (60/-180)*Math.PI;

        let x0 = canvas.width/2;
        let y0 = canvas.height/2;

        let distance = dist(this.midX, this.midY, x0, y0);

        let alpha = Math.atan2((this.midY-y0),(this.midX-x0))
  
        let phase = Math.cos((this.angle - alpha))*distance;
        let amplitude = 30;

        d = amplitude*Math.sin((phase/30+time/20.0))  ;
    

        if (d<0){
            d = -d;
            this.angle+=Math.PI;
        }


        /* Create a factor by which to scale the vector length and color. */
        factor = d / (canvas.width * 1.3);
        this.len = (d > 30) ? 30 : d;

        let h = this.angle/Math.PI*180;
        let s = amplitude+d;
        let l = 35;


        /* Call the draw() method with the updated color. */
        this.draw(`hsl(${h}, ${s}%, ${l}%)`);
    };
    /**
     * Draw the vector's arrow head.
     * @method
     *
     * @param {Number} x - The x-coordinate of the end of the vector.
     * @param {Number} y - The y-coordinate of the end of the vector.
     * @param {String} color - The color of the vector in HSL format.
     */
    this.drawArrow = function(x, y, color) {
        let px, py,
            headRadius = 5,
            angle = this.angle;

        ctx.fillStyle = color;
        ctx.beginPath();

        for (let i = 0; i < 3; ++i) {
            px = headRadius * Math.cos(angle) + x;
            py = headRadius * Math.sin(angle) + y;

            /* Move 120 degrees around the point (x, y). */
            angle += 2.0 * Math.PI / 3.0;

            /* Connect the triangle's vertices. */
            if (i) {
                ctx.lineTo(px, py);
            } else {
                ctx.moveTo(px, py);
            }
        }
        /* Close off and fill the triangle. */
        ctx.closePath();
        ctx.fill();
    }
}

/**
 * An object representing the vector field.
 * @class
 *
 * @property {Number[]} size - The number of rows and columns.
 * @property {Number[]} offsets - The x and y offsets of the vector field.
 * @property {Array.<Vector[]>} grid - A 2-D array of vector objects.
 */
function VectorField(cols, rows, xOffset, yOffset) {
    this.size = [cols, rows];
    this.offsets = [xOffset, yOffset];
    this.grid = [];
    this.time = 0;
    /**
     * Initialize the vector field.
     * @method
     */
    this.init = function() {
        let spaceX = Math.floor(canvas.width / this.size[0]),
            spaceY = Math.floor(canvas.height / this.size[1]),
            [x, y] = this.offsets,
            row;

        /* Create a 2-D array of vectors, evenly spaced accross
         * the window. */
        for (let j = 0; j < this.size[1]; j++) {
            row = [];

            for (let i = 0; i < this.size[0]; i++) {
                row.push(new Vector(x, y));
                x += spaceX;
            }
            y += spaceY;
            x = this.offsets[0];
            this.grid.push(row);
        }
    };
    /**
     * Draw the grid lines.
     * @method
     */
    this.drawGrid = function() {
        let x, y;
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#ccc";
        ctx.beginPath();

        /* Draw the horizontal grid lines. */
        for (let row of this.grid) {
            y = row[0].midY;
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
        }
        /* Draw the vertical grid lines. */
        for (let col of this.grid[0]) {
            x = col.midX;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
        }
        ctx.stroke();
    };
    /**
     * Update the vectors and draw the grid.
     * @function
     */
    this.update = function() {

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.time++;
        this.drawGrid();

        for (let row of this.grid) {

            for (let vector of row) {
                vector.update(this.time);
            }
        }
    };
}

/**
 * Update the vector field whenever the cursor is moved.
 * @callback
 */
setInterval(function(){field.update();}, 30);


/**
 * Setup the animation.
 * @function
 */
function setup() {
    let cols, rows,
        offsets = [20, 20];

    /* Set the canvas dimensions. */
    canvas = document.querySelector("canvas");
    canvas.height = window.innerHeight;
    canvas.width = window.innerWidth;

    /* Get the canvas drawing context. */
    ctx = canvas.getContext("2d");

    /* Create and initialize the vector field. */
    cols = canvas.width / 28;
    rows = canvas.height / 28;
    field = new VectorField(cols, rows, ...offsets);
    field.init();
}

setup();
