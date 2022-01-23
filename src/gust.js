export class Gust{
  constructor(map){

    this.map = map

    this.age = 0
    this.maxage = 1000

    this.beam_width = 10
    this.beam_height = 10
    this.beam_direction = 0
    this.beam_elevation = 0.1

    this.strength = 1

    this.center_x = 0;
    this.center_y = 0;

  }

  physics_model_step(){

    for(let x=-this.beam_width; x<=this.beam_width; x++){

      for(let y=-this.beam_height; y<=this.beam_height; y++){
		
		let x_ = x/this.beam_width
		let y_ = y/this.beam_height

        if (Math.sqrt(x_*x_ + y_*y_)<1 ){

          let angle = Math.atan2(y-this.beam_height*(1-this.beam_elevation), x)/Math.PI * 180
  
		  let x_rotated = Math.cos(this.beam_direction/180*Math.PI) * x + -Math.sin(this.beam_direction/180*Math.PI) * y
		  let y_rotated = Math.sin(this.beam_direction/180*Math.PI) * x + Math.cos(this.beam_direction/180*Math.PI) * y

          this.map.fluid.apply_energy(this.center_x + x_rotated, this.center_y + y_rotated, angle + this.beam_direction, -this.strength)


        }

  
      }
  
    }

  }



}
