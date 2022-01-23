


export class Gust{
  constructor(map){

    this.map = map

    this.age = 0
    this.maxage = 4000

    this.parameter = []
    this.parameter[0] = [20, 0]       //x
    this.parameter[1] = [0, 10]       //y
    this.parameter[2] = [10, 50]      //w
    this.parameter[3] = [10, 5]       //h
    this.parameter[4] = [0, 0]        //angle
    this.parameter[5] = [0.1, 0.5]    //elevation
    
    this.strength = 3


    this.result = []
    this.result[0] =  (this.parameter[0][0]*(this.maxage-this.age) + this.parameter[0][1]*(this.age))/this.maxage;
    this.result[1] =  (this.parameter[1][0]*(this.maxage-this.age) + this.parameter[1][1]*(this.age))/this.maxage;
    this.result[2] =  (this.parameter[2][0]*(this.maxage-this.age) + this.parameter[2][1]*(this.age))/this.maxage;
    this.result[3] =  (this.parameter[3][0]*(this.maxage-this.age) + this.parameter[3][1]*(this.age))/this.maxage;
    this.result[4] =  (this.parameter[4][0]*(this.maxage-this.age) + this.parameter[4][1]*(this.age))/this.maxage;
    this.result[5] =  (this.parameter[5][0]*(this.maxage-this.age) + this.parameter[5][1]*(this.age))/this.maxage;



  }

  physics_model_step(){


    this.result[0] =  (this.parameter[0][0]*(this.maxage-this.age) + this.parameter[0][1]*(this.age))/this.maxage;
    this.result[1] =  (this.parameter[1][0]*(this.maxage-this.age) + this.parameter[1][1]*(this.age))/this.maxage;
    this.result[2] =  (this.parameter[2][0]*(this.maxage-this.age) + this.parameter[2][1]*(this.age))/this.maxage;
    this.result[3] =  (this.parameter[3][0]*(this.maxage-this.age) + this.parameter[3][1]*(this.age))/this.maxage;
    this.result[4] =  (this.parameter[4][0]*(this.maxage-this.age) + this.parameter[4][1]*(this.age))/this.maxage;
    this.result[5] =  (this.parameter[5][0]*(this.maxage-this.age) + this.parameter[5][1]*(this.age))/this.maxage;

    this.p_beam_x = this.result[0] 
    this.p_beam_y = this.result[1] 
    this.p_beam_width = this.result[2] 
    this.p_beam_height = this.result[3] 
    this.p_beam_direction = this.result[4] 
    this.p_beam_elevation = this.result[5] 


    let strength = this.strength* Math.sin(Math.PI*this.age/this.maxage) * (this.p_beam_width + this.p_beam_height)/20

    let area = Math.PI/4 * this.p_beam_width * this.p_beam_height

    let intensity = strength/area

    for(let x=-this.p_beam_width/2; x<=this.p_beam_width/2; x++){

      for(let y=-this.p_beam_height/2; y<=this.p_beam_height/2; y++){
		
        let x_ = x/(this.p_beam_width/2)
        let y_ = y/(this.p_beam_height/2)

        if (Math.sqrt(x_*x_ + y_*y_)<1 ){

          let angle = Math.atan2(y-this.p_beam_height/2*(1-this.p_beam_elevation), x)/Math.PI * 180
  
		  let x_rotated = Math.cos(this.p_beam_direction/180*Math.PI) * x + -Math.sin(this.p_beam_direction/180*Math.PI) * y
		  let y_rotated = Math.sin(this.p_beam_direction/180*Math.PI) * x + Math.cos(this.p_beam_direction/180*Math.PI) * y


          this.map.fluid.apply_energy(this.p_beam_x + x_rotated, this.p_beam_y + y_rotated, angle + this.p_beam_direction, -intensity)


        }

  
      }
  
    }

    if (this.age<this.maxage){
      this.age++;
    }

  }



}
