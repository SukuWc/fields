// Client view state: camera position / zoom / follow and the drawing toggles
// (forces, field). Moved out of map.js so the simulation world carries no
// camera. The renderer reads it; controls.js, touch and scenario view hints
// change it.
export class View {
  constructor() {
    this.show_forces = false;
    this.show_refinement = false;
    this.show_fields = false;

    this.camera_follow_target = undefined;
    this.camera_follow = false;
    this.camera_zoom = 30;
    this.camera_zoom_max = 70;
    this.camera_zoom_min = 10;

    this.camera_position_x = 0;
    this.camera_position_y = 0;

    this.camera_position_x_max = 30;
    this.camera_position_x_min = -30;

    this.camera_position_y_max = 30;
    this.camera_position_y_min = -30;
  }

  set_camera_follow_target(obj) {
    this.camera_follow_target = obj;
  }

  _clamp() {
    if (this.camera_position_x > this.camera_position_x_max) this.camera_position_x = this.camera_position_x_max;
    if (this.camera_position_y > this.camera_position_y_max) this.camera_position_y = this.camera_position_y_max;
    if (this.camera_position_x < this.camera_position_x_min) this.camera_position_x = this.camera_position_x_min;
    if (this.camera_position_y < this.camera_position_y_min) this.camera_position_y = this.camera_position_y_min;
  }

  // Follow the target (boat 0) when camera follow is on. Was Map.physics_model_step.
  update() {
    if (this.camera_follow === true && this.camera_follow_target !== undefined) {
      this.camera_position_x = this.camera_follow_target.x;
      this.camera_position_y = this.camera_follow_target.y;
      this._clamp();
    }
  }

  input_show_fields(e) { this.show_fields = e; }
  input_show_forces(e) { this.show_forces = e; }
  input_show_refinement(e) { this.show_refinement = !!e; }
  input_camera_follow(e) { this.camera_follow = e; }

  input_camera_zoom_relative(e) {
    this.camera_zoom += e * Math.max(1, (this.camera_zoom - 15) / 15);
    if (this.camera_zoom > this.camera_zoom_max) this.camera_zoom = this.camera_zoom_max;
    if (this.camera_zoom < this.camera_zoom_min) this.camera_zoom = this.camera_zoom_min;
  }

  input_camera_move_relative(dx, dy) {
    this.camera_position_x += dx;
    this.camera_position_y += dy;
    this._clamp();
  }
}
