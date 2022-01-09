/*

Dean's 2D fluid sim.

http://neuroid.co.uk
dean@neuroid.co.uk

*/



export let fluid = {
	
	vectorField:undefined,

	particles:[],
	particleCount:400,

	maxParticleSpeed:8,

	colors:[],


	isMobile:false,
	objCanvas:undefined,
	ctx:undefined,

	enableFrameDragging:true,
	enableEmitter:true,

	loopTimer:undefined,
	loopTicker:0,

	emitterX:0,
	emitterY:0,

	init:function(){
		
		//
		var ua = navigator.userAgent.toLowerCase();
		this.isMobile = ua.indexOf('android') !== -1 || ua.indexOf('webos') !== -1 || ua.indexOf('iphone') !== -1 || ua.indexOf('ipad') !== -1 || ua.indexOf('ipod') !== -1 || ua.indexOf('blackberry') !== -1 || ua.indexOf('windows phone') !== -1;

		// init vars
		this.initVectorField();
		this.initParticles();
		this.initColors();

		//this.start();
	},
	
	initVectorField:function(){
		//
		this.vectorField = new vectorField( 800,800, 80,80 );
		
	},

	initParticles:function(){
		if( this.isMobile ) this.particleCount >>= 1;

		var p;
		var i = this.particleCount;
		while( i-- ){
			p = new particle(
				Math.random() * this.vectorField.width,
				Math.random() * this.vectorField.height
			);
			p.vx = (Math.random() - .5) * 2;
			p.vy = (Math.random() - .5) * 2;
			this.particles[i] = p;
		}

	},

	initColors:function(){
		var cols = this.colors;
		var i, mf;
		var red,green,blue;

		for( i=0; i<=255; i++ ){
			mf = i/255;

			red = Math.min( mf / .85, .85 ) * (1/.85) * 155 + 100>>0;
			green = mf * 155 + 100>>0;
			blue = 240;
			cols[i] = 'rgb(' + red + ',' + green + ',' + blue + ')';
		}
	},

	start:function(){
		window.requestAnimationFrame = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame || window.msRequestAnimationFrame;
		window.animateFrame = function( time ){
			fluid.loop();
			window.animateTimestamp = time;
			window.requestAnimationFrame( animateFrame );
		}
		window.animateFrame();
	},


	// ================================================== Loop ==================================================

	loop:function(){
		this.loopTicker++;


		this.updateParticles();
		this.updateVectorField();

	},



	updateParticles:function(){
		//
		var field = this.vectorField.field;

		var w = this.vectorField.width;
		var h = this.vectorField.height;

		var ax,ay;
		var aw = this.vectorField.areaWidth;
		var ah = this.vectorField.areaHeight;
		var axmf = this.vectorField.areaWidth / this.vectorField.width;
		var aymf = this.vectorField.areaHeight / this.vectorField.height;

		var maxspeed = this.maxParticleSpeed;
		var dis,mf;

		var p, i = this.particleCount;
		while( i-- ){
			p = this.particles[ i ];

			// limit velocity (angular)
			dis = Math.sqrt( p.vx * p.vx + p.vy * p.vy );
			if( dis > maxspeed ){
				mf = maxspeed / dis;
				p.vx *= mf;
				p.vy *= mf;
			}
			p.speed = dis;


			// friction
			//p.vx *= 0.9;
			//p.vy *= 0.9;

			p.ox = p.x;
			p.oy = p.y;
			p.x += p.vx;
			p.y += p.vy;

			if( p.x < 0 ) p.ox = p.x += w;
			if( p.x > w ) p.ox = p.x -= w;
			if( p.y < 0 ) p.oy = p.y += h;
			if( p.y > h ) p.oy = p.y -= h;


			// SUKU HACK to limit simulated area
			if( p.x < 250 ) p.ox = p.x += 300;
			if( p.x > 550 ) p.ox = p.x -= 300;

			if( p.y < 250 ) {
				p.oy = p.y += 300
				p.x = 250 + Math.random()*300
				p.ox = p.x		
			};
			if( p.y > 550 ) {
				p.oy = p.y -= 300;
				p.x = 250 + Math.random()*300
				p.ox = p.x
			}



			ax = (((p.x + p.vx * 5) * axmf >> 0) + aw) % aw;
			ay = (((p.y + p.vy * 5) * aymf >> 0) + ah) % ah;

			// particles velocity influences area
			//field[ax][ay].vx += p.vx *.05;
			//field[ax][ay].vy += p.vy *.05;

			
			// SUKU HACK to limit simulated area
			// areas velocity influences particle
			
			p.ox = p.x + (p.x-p.ox)*4
			p.oy = p.y + (p.y-p.oy)*4

			p.vx *=0.25
			p.vy *=0.25

			p.vx += field[ax][ay].vx * .75;
			p.vy += field[ax][ay].vy * .75;
		}
	},

	updateVectorField:function(){
		//
		var field = this.vectorField.field;

		var aw = this.vectorField.areaWidth;
		var ah = this.vectorField.areaHeight;
		var ax,ay;

		var vx,vy,vx_,vy_;

		// get new vx,vy
		ax = aw;
		while( ax-- ){
			ay = ah;
			while( ay-- ){

				// blend this areas velocity with surrounding areas
				vx = 0 +
					(ax > 0 ? field[ax-1][ay].vx : 0) +
					(ax + 1 < aw ? field[ax+1][ay].vx : 0) +
					(ay > 0 ? field[ax][ay-1].vx : 0) +
					(ay + 1 < ah ? field[ax][ay+1].vx : 0);

				vy = 0 +
					(ax > 0 ? field[ax-1][ay].vy : 0) +
					(ax + 1 < aw ? field[ax+1][ay].vy : 0) +
					(ay > 0 ? field[ax][ay-1].vy : 0) +
					(ay + 1 < ah ? field[ax][ay+1].vy : 0);

					
				// SUKU HACK to improve field recovery
				vx_ = vx *.2 + field[ax][ay].vx*0.8; // store new vx
				vy_ = vy *.2 + field[ax][ay].vy*0.8; // store new vy
				
				
				// old implementation
				// vx_ = vx *.1 + field[ax][ay].vx; // store new vx
				// vy_ = vy *.1 + field[ax][ay].vy; // store new vy

				// limit area velocity (angular)
				let dis = Math.sqrt( vx_ * vx_ + vy_ * vy_ );
				if( dis > 1 ){
					let mf = 1 / dis;
					vx_ *= mf;
					vy_ *= mf;
				}

				//
				field[ax][ay].vx_ = vx_;
				field[ax][ay].vy_ = vy_;

			}
		}

		// clear vx and vy values
		
		ax = aw;
		while( ax-- ){
			ay = ah;
			while( ay-- ){
				field[ax][ay].vx__ = 0
				field[ax][ay].vy__ = 0
			}
		}
		

		// copy across velocities

		ax = aw;
		while( ax-- ){
			ay = ah;
			while( ay-- ){

				let vx_next = field[ax][ay].vx *0.9 + field[ax][ay].vx_*0.1
				let vy_next = field[ax][ay].vy *0.9 + field[ax][ay].vy_*0.1

				let grid_size = 1

				/*
					vy_next == 60 => vf = 1
					vy_next == 30 => vf = 0.5
					vy_next == 15 => vf = 0.25
				
				*/

				let horizontal_factor = 0
				let vertical_factor = -vy_next/30

				/*
				// Horizontal
				if (vx_next>0){
					if (ax<field.width-1){
						field[ax+1][ay].vx__ += vx_next*horizontal_factor
						field[ax+1][ay].vy__ += vy_next*horizontal_factor
					}
					else{
						field[ax][ay].vx__ += vx_next
						field[ax][ay].vy__ += vy_next
					}
				}
				else{
					if (ax>0+1){
						field[ax-1][ay].vx__ += vx_next*horizontal_factor
						field[ax-1][ay].vy__ += vy_next*horizontal_factor
					}
					else{
						field[ax][ay].vx__ += vx_next
						field[ax][ay].vy__ += vy_next
					}
				}

				*/

				// Vertical
				if (vy_next>0){
					if (ay<field.height-1){
						field[ax][ay+1].vx__ += vx_next*vertical_factor
						field[ax][ay+1].vy__ += vy_next*vertical_factor
					}
					else{
						field[ax][ay].vx__ += vx_next
						field[ax][ay].vy__ += vy_next
					}
				}
				else{
					if (ay>0+1){
						field[ax][ay-1].vx__ += vx_next*vertical_factor
						field[ax][ay-1].vy__ += vy_next*vertical_factor
					}
					else{
						field[ax][ay].vx__ += vx_next
						field[ax][ay].vy__ += vy_next
					}
				}
				
				field[ax][ay].vx__ += vx_next*(1-horizontal_factor-vertical_factor)
				field[ax][ay].vy__ += vy_next*(1-horizontal_factor-vertical_factor)
				

				// map boundary condition
				if (ay == 56 || ay == 24 || ax == 56 || ax == 24){
					field[ax][ay].vx__ = 0
					field[ax][ay].vy__ = -2
				}

			}
		}

		ax = aw;
		while( ax-- ){
			ay = ah;
			while( ay-- ){
				field[ax][ay].vx = field[ax][ay].vx__
				field[ax][ay].vy = field[ax][ay].vy__
			}
		}
	},

	moveParticles:function( x,y, vx,vy ){

		var dis,mf;
		var influence = Math.sqrt( vx * vx + vy * vy ) * 4;
		if( influence > 100 ) influence = 100;

		var p, i = this.particleCount;
		while( i-- ){
			p = this.particles[ i ];

			// limit velocity (angular)
			dis = Math.sqrt( (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) );
			if( dis < influence ){
				mf = 1 - dis/influence;
				mf *= mf * mf * mf * mf;
				p.vx = p.vx * (1 - mf) + vx * mf;
				p.vy = p.vy * (1 - mf) + vy * mf;
			}

		}


		var field = this.vectorField.field;

		var aw = field.areaWidth;
		var ah = field.areaHeight;
		var axmf = this.vectorField.areaWidth / this.vectorField.width;
		var aymf = this.vectorField.areaHeight / this.vectorField.height;

		var amx = x * axmf >>0;
		var amy = y * aymf >>0;
		var arangex = influence * axmf + 1 << 1;
		var arangey = influence * aymf + 1 << 1;
		var ax,ay;
		var area;

		for( ax = amx - arangex; ax <= amx + arangex; ax++ ){
			if( ax >= 0 && field[ax] ){
				for( ay = amy - arangey; ay <= amy + arangey; ay++ ){
					if( ay >= 0 && field[ax][ay] ){

						area = field[ax][ay];
						area.vx = 0;
						area.vy = 0;
						area.vx_ = 0;
						area.vy_ = 0;

					}
				}
			}
		}
	}

}



let vectorField = function( w, h, aw, ah ){
	this.field = [];

	this.width = w;
	this.height = h;

	this.areaWidth = aw;
	this.areaHeight = ah;

	// init array
	var x,y;
	x = aw;
	while( x-- ){
		this.field[x] = [];

		y = ah;
		while( y-- ){

			this.field[x][y] = new fieldArea();
		}
	}


}

let fieldArea = function(){
	// area within field. each area has velocity.

	this.vx = 0;
	this.vy = -2;

	this.vx_ = 0;
	this.vy_ = -2;

	this.vx__ = 0;
	this.vy__ = -2;
}


let particle = function( x, y ){
	this.x = this.ox = x;
	this.y = this.oy = y;

	this.vx = 0;
	this.vy = 0;

	this.speed = 0; // speed
}
